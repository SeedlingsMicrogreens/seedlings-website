import { HttpError } from './httpError';

/**
 * One customer-ownership rule for checkout claims, payment-session creation,
 * verification and finalization (SYSTEM-INTEGRATION.md §13 "Customer
 * ownership"). The UID is resolved to a customer only through trusted server
 * data; a client-supplied mobile is a lookup key, never proof.
 */

type Data = Record<string, unknown>;

export type OwnershipStore = {
  getCustomer: (customerId: string) => Promise<Data | undefined>;
  /** Customers whose `authUid` is, or whose `authUids` contain, this UID. */
  customersWithUid: (uid: string) => Promise<Array<{ id: string; data: Data }>>;
};

export type CustomerIdentity = { uid: string; customerId: string; uids: string[] };

export type OwnershipOptions = {
  /** Lookup key only (e.g. the submitted mobile); never proof of ownership. */
  mobileHint?: unknown;
  /** Record UID fields checked against the resolved customer. */
  uidFields?: string[];
  /** Fields compared exactly with the caller UID when no customer identity resolves. */
  strictUidFields?: string[];
};

/**
 * The authenticated caller: a UID and, when present, the server-issued
 * `customerId` token claim. Only a value from the verified ID token may be put
 * here (never a request field); it is still checked against the customer record.
 */
export type PaymentCaller = { uid: string; customerId?: unknown };

export const NOT_OWNED = 'This order is not available for your account.';
export const IDENTITY_NOT_CONFIRMED = 'We could not confirm your sign-in. Please sign in again to continue.';
export const SESSION_MISMATCH = 'You are signed in to a different account than this checkout. Please refresh the page and try again.';

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
export const mobileOf = (value: unknown) => String(value ?? '').replace(/\D/g, '').slice(-10);

export function customerUids(customer: Data | undefined) {
  if (!customer) return [];
  const aliases = Array.isArray(customer.authUids) ? customer.authUids.map(clean) : [];
  return [...new Set([clean(customer.authUid), ...aliases].filter(Boolean))];
}

export function callerOf(caller: string | PaymentCaller): PaymentCaller {
  return typeof caller === 'string' ? { uid: caller } : caller;
}

/**
 * Resolves the caller to a customer. Candidates are the token's `customerId`
 * claim and an optional mobile hint; each is accepted only if that customer
 * record lists the UID. Otherwise customers are searched by UID, and only an
 * unambiguous match is trusted. Returns null when no customer lists the UID.
 */
export async function resolveCustomerIdentity(store: OwnershipStore, caller: string | PaymentCaller, mobileHint?: unknown): Promise<CustomerIdentity | null> {
  const { uid, customerId: claim } = callerOf(caller);
  if (!uid) return null;
  const candidates = [...new Set([mobileOf(claim), mobileOf(mobileHint)].filter((id) => id.length === 10))];
  for (const candidate of candidates) {
    const uids = customerUids(await store.getCustomer(candidate));
    if (uids.includes(uid)) return { uid, customerId: candidate, uids };
  }
  const matches = (await store.customersWithUid(uid)).filter((match) => customerUids(match.data).includes(uid));
  const distinct = [...new Map(matches.map((match) => [match.id, match])).values()];
  if (distinct.length !== 1) return null;
  return { uid, customerId: distinct[0].id, uids: customerUids(distinct[0].data) };
}

/**
 * True when the record belongs to the caller. With a resolved identity: the
 * record's customer must be that customer, and each of its UIDs must be empty
 * (historical), one of the customer's verified UIDs, or an outdated UID that no
 * other customer has verified. Without one: the previous strict rule.
 */
export async function isRecordOwned(
  store: OwnershipStore,
  identity: CustomerIdentity | null,
  caller: PaymentCaller,
  record: Data,
  options: OwnershipOptions = {},
): Promise<boolean> {
  const fields = options.uidFields ?? ['authUid', 'paymentAuthUid'];
  const recordUids = fields.map((field) => clean(record[field])).filter(Boolean);
  if (!identity) {
    // Exactly the endpoint's previous check (session creation: authUid;
    // verification: paymentAuthUid), so nothing that worked before is refused.
    const hint = mobileOf(options.mobileHint);
    const strictUids = (options.strictUidFields ?? fields).map((field) => clean(record[field]));
    return strictUids.length > 0
      && strictUids.every((uid) => uid === caller.uid)
      && (!hint || mobileOf(record.customerId) === hint);
  }
  if (mobileOf(record.customerId) !== identity.customerId) return false;
  for (const recordUid of recordUids) {
    if (identity.uids.includes(recordUid)) continue;
    const owners = await store.customersWithUid(recordUid);
    if (owners.some((owner) => owner.id !== identity.customerId && customerUids(owner.data).includes(recordUid))) return false;
  }
  return true;
}

/**
 * The signed-in customer acting on `requestedCustomerId`'s checkout. No
 * resolvable customer identity → 401 `unauthenticated` (sign in again); a
 * different verified customer → 409 `session_mismatch` (refresh / switch
 * account). Neither response reveals anything about the requested customer.
 */
export async function assertCallerIsCustomer(store: OwnershipStore, caller: string | PaymentCaller, requestedCustomerId: unknown): Promise<CustomerIdentity> {
  const requested = mobileOf(requestedCustomerId);
  const identity = await resolveCustomerIdentity(store, caller, requested);
  if (!identity) throw new HttpError(401, IDENTITY_NOT_CONFIRMED, 'unauthenticated');
  if (identity.customerId !== requested) throw new HttpError(409, SESSION_MISMATCH, 'session_mismatch');
  return identity;
}

export async function assertCallerOwnsProfilePhoto(store: OwnershipStore, caller: string | PaymentCaller, photoUrl: string): Promise<CustomerIdentity> {
  const identity = await resolveCustomerIdentity(store, caller);
  if (!identity) throw new HttpError(403, 'Your customer account could not be confirmed.');
  const customer = await store.getCustomer(identity.customerId);
  if (!customer || clean(customer.profilePhotoUrl) !== photoUrl) {
    throw new HttpError(403, 'This photo does not belong to your account.');
  }
  return identity;
}

/** Throws the generic 403 unless every record belongs to the caller. */
export async function assertRecordsOwned(
  store: OwnershipStore,
  caller: string | PaymentCaller,
  records: Data[],
  options: OwnershipOptions & { identity?: CustomerIdentity | null } = {},
) {
  const normalized = callerOf(caller);
  const identity = options.identity !== undefined ? options.identity : await resolveCustomerIdentity(store, normalized, options.mobileHint);
  for (const record of records) {
    if (!(await isRecordOwned(store, identity, normalized, record, options))) throw new HttpError(403, NOT_OWNED, 'not_owned');
  }
  return identity;
}

/** Ownership store over the Firebase Admin Firestore (or a compatible fake). */
export function firestoreOwnershipStore(db: {
  collection: (name: string) => {
    doc: (id: string) => { get: () => Promise<{ exists: boolean; data: () => Data | undefined }> };
    where: (field: string, op: FirebaseFirestore.WhereFilterOp, value: unknown) => { get: () => Promise<{ docs: Array<{ id: string; data: () => Data | undefined }> }> };
  };
}): OwnershipStore {
  return {
    getCustomer: async (customerId) => {
      const snapshot = await db.collection('customers').doc(customerId).get();
      return snapshot.exists ? snapshot.data() || {} : undefined;
    },
    customersWithUid: async (uid) => {
      const [byAlias, byPrimary] = await Promise.all([
        db.collection('customers').where('authUids', 'array-contains', uid).get(),
        db.collection('customers').where('authUid', '==', uid).get(),
      ]);
      return [...byAlias.docs, ...byPrimary.docs].map((doc) => ({ id: doc.id, data: doc.data() || {} }));
    },
  };
}
