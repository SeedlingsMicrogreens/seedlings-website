import test from 'node:test';
import assert from 'node:assert/strict';

import { handleCommittedDemandRequest, type CommittedDemandDeps } from '../../lib/server/committedDemand';
import { HttpError } from '../../lib/server/httpError';
import { COMMITTED_DEMAND_UNAVAILABLE, requestCommittedDemand } from '../../lib/committedDemandClient';
import { resolveDeliveryDatesWithContexts, type AvailabilityRecord } from '../../lib/customerAvailabilityMath';

const TODAY = '2026-10-11';
const BROCCOLI = 'XXZ07k6VufndhUyxXyic';
const RADISH = 'micro-radish';
const broccoli106 = { id: 'M8zblixDt66ySITbCXo9', name: 'Broccoli 106 gms', type: 'single', components: [{ productId: BROCCOLI, productName: 'Broccoli', quantityGrams: 105 }] } as any;
const radish100 = { id: 'radish-100', name: 'Radish', type: 'single', components: [{ productId: RADISH, productName: 'Radish', quantityGrams: 100 }] } as any;

// Records carry the personal data real documents contain; none of it may reach the response.
const PII = { customerName: 'Asha Patil', customerMobile: '9876543210', deliveryAddress: { line1: '12 MG Road', pincode: '411001' }, authUid: 'uid-other-customer', customerId: '9876543210' };

function order(id: string, date: string, salable: any, quantity: number, extra: Record<string, unknown> = {}): AvailabilityRecord {
  return { id, data: { ...PII, orderNumber: `ORD-${id}`, scheduledDeliveryDate: date, status: 'confirmed', paymentStatus: 'paid', items: [{ salableProductId: salable.id, packaging: 100, quantity }], ...extra } };
}

function subscription(id: string, date: string, salable: any, quantity: number): AvailabilityRecord {
  return { id, data: { ...PII, subscriptionNumber: `SUB-${id}`, status: 'active', paymentStatus: 'paid', nextDeliveryDate: date, salableProductId: salable.id, packaging: 100, quantity } };
}

const RECORDS = {
  orders: [
    order('o17', '2026-10-17', broccoli106, 1),
    order('o17-radish', '2026-10-17', radish100, 2),
    order('o24', '2026-10-24', broccoli106, 2),
    order('o24-cancelled', '2026-10-24', broccoli106, 5, { status: 'cancelled' }),
    order('o24-unpaid', '2026-10-24', broccoli106, 5, { status: 'pending_payment', paymentStatus: 'pending' }),
  ],
  subscriptions: [subscription('s17', '2026-10-17', broccoli106, 1), subscription('s24', '2026-10-24', broccoli106, 1)],
};

function deps(overrides: Partial<CommittedDemandDeps> = {}) {
  const calls = { readCommitments: [] as string[], readSalesProducts: 0, logged: [] as unknown[] };
  const value: CommittedDemandDeps = {
    verifyUser: async (request) => {
      const header = request.headers.get('authorization') || '';
      if (!/^Bearer\s+valid-token$/i.test(header)) throw new HttpError(401, header ? 'Your login session is invalid or expired.' : 'Authentication is required.');
      return { uid: 'customer-uid' };
    },
    readCommitments: async (deliveryDate) => {
      calls.readCommitments.push(deliveryDate);
      return {
        orders: RECORDS.orders.filter((record) => record.data.scheduledDeliveryDate === deliveryDate),
        subscriptions: RECORDS.subscriptions.filter((record) => record.data.nextDeliveryDate === deliveryDate),
      };
    },
    readSalesProducts: async (ids) => { calls.readSalesProducts += 1; return [broccoli106, radish100].filter((product) => ids.includes(product.id)); },
    today: () => TODAY,
    logError: (_message, error) => { calls.logged.push(error); },
    ...overrides,
  };
  return { deps: value, calls };
}

function request(query: string, token: string | null = 'valid-token') {
  return new Request(`http://localhost/api/customer/committed-demand?${query}`, { headers: token === null ? {} : { Authorization: `Bearer ${token}` } });
}

test('missing or invalid authentication returns 401 and reads nothing', async () => {
  for (const token of [null, 'expired-token']) {
    const { deps: d, calls } = deps();
    const result = await handleCommittedDemandRequest(request(`deliveryDate=2026-10-17&productIds=${BROCCOLI}`, token), d);
    assert.equal(result.status, 401);
    assert.deepEqual(calls.readCommitments, []);
  }
});

test('invalid delivery dates and dates outside the permitted range return 400 and read nothing', async () => {
  for (const deliveryDate of ['', 'abc', '2026-13-01', '2026-02-30', '17-10-2026', '2026-09-09', '2027-04-13']) {
    const { deps: d, calls } = deps();
    const result = await handleCommittedDemandRequest(request(`deliveryDate=${deliveryDate}&productIds=${BROCCOLI}`), d);
    assert.equal(result.status, 400, deliveryDate);
    assert.deepEqual(calls.readCommitments, [], deliveryDate);
  }
  // Range edges are accepted (31 days before, 183 days after today).
  for (const deliveryDate of ['2026-09-10', '2027-04-12']) {
    const { deps: d } = deps();
    assert.equal((await handleCommittedDemandRequest(request(`deliveryDate=${deliveryDate}&productIds=${BROCCOLI}`), d)).status, 200, deliveryDate);
  }
});

test('empty, malformed and excessive product ID lists return 400 and read nothing', async () => {
  const tooMany = Array.from({ length: 31 }, (_, index) => `p${index}`).join(',');
  for (const productIds of ['', ',,', 'bad id', '../orders', 'a'.repeat(129), tooMany]) {
    const { deps: d, calls } = deps();
    const result = await handleCommittedDemandRequest(request(`deliveryDate=2026-10-17&productIds=${encodeURIComponent(productIds)}`), d);
    assert.equal(result.status, 400, productIds.slice(0, 20));
    assert.deepEqual(calls.readCommitments, []);
  }
  // 30 unique IDs (duplicates collapse) are accepted.
  const thirty = Array.from({ length: 30 }, (_, index) => `p${index}`).concat(['p0']).join(',');
  const { deps: d } = deps();
  assert.equal((await handleCommittedDemandRequest(request(`deliveryDate=2026-10-17&productIds=${thirty}`), d)).status, 200);
});

test('totals: same-date subscriptions and one-time orders only; other dates, cancelled and unpaid excluded', async () => {
  const { deps: d, calls } = deps();
  const result = await handleCommittedDemandRequest(request(`deliveryDate=2026-10-24&productIds=${BROCCOLI},${RADISH}`), d);
  assert.equal(result.status, 200);
  assert.deepEqual(calls.readCommitments, ['2026-10-24']);
  assert.deepEqual(result.body, {
    deliveryDate: '2026-10-24',
    subscriptionCommitted: { [BROCCOLI]: 100 },
    oneTimeCommitted: { [BROCCOLI]: 200 },
    committedDemandGrams: 300,
  });
});

test('maps contain only the requested Microgreens; threshold total stays the whole date', async () => {
  const { deps: d } = deps();
  const result = await handleCommittedDemandRequest(request(`deliveryDate=2026-10-17&productIds=${RADISH}`), d);
  assert.deepEqual(result.body, {
    deliveryDate: '2026-10-17',
    subscriptionCommitted: {},
    oneTimeCommitted: { [RADISH]: 200 },
    committedDemandGrams: 400,
  });
});

test('response contains only the approved aggregate fields and no customer or order data', async () => {
  const { deps: d } = deps();
  const result = await handleCommittedDemandRequest(request(`deliveryDate=2026-10-24&productIds=${BROCCOLI},${RADISH}`), d);
  assert.deepEqual(Object.keys(result.body).sort(), ['committedDemandGrams', 'deliveryDate', 'oneTimeCommitted', 'subscriptionCommitted']);
  const json = JSON.stringify(result.body);
  for (const secret of ['Asha', '9876543210', 'MG Road', '411001', 'uid-other-customer', 'ORD-', 'SUB-', 'o17', 's17', broccoli106.id]) {
    assert.equal(json.includes(secret), false, secret);
  }
});

test('server failures return a generic 500 without internal details', async () => {
  const { deps: d, calls } = deps({ readCommitments: async () => { throw new Error('PERMISSION_DENIED: projects/internal-path'); } });
  const result = await handleCommittedDemandRequest(request(`deliveryDate=2026-10-17&productIds=${BROCCOLI}`), d);
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: 'Unable to load committed demand.' });
  assert.equal(calls.logged.length, 1);
});

function fakeFetch(status: number, body: unknown, captured: { url?: string; auth?: string } = {}) {
  return (async (url: string, init?: RequestInit) => {
    captured.url = url;
    captured.auth = new Headers(init?.headers).get('authorization') || '';
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

test('client sends the ID token and parses only requested Microgreen totals', async () => {
  const captured: { url?: string; auth?: string } = {};
  const totals = await requestCommittedDemand({
    fetchImpl: fakeFetch(200, { deliveryDate: '2026-10-17', subscriptionCommitted: { [BROCCOLI]: 100, other: 999 }, oneTimeCommitted: { [BROCCOLI]: 'x' }, committedDemandGrams: 400 }, captured),
    idToken: 'token-123',
    deliveryDate: '2026-10-17',
    productIds: [BROCCOLI],
  });
  assert.equal(captured.auth, 'Bearer token-123');
  assert.ok(captured.url?.startsWith('/api/customer/committed-demand?deliveryDate=2026-10-17&productIds='));
  assert.deepEqual(totals, { subscriptionCommitted: { [BROCCOLI]: 100 }, oneTimeCommitted: {}, committedDemandGrams: 400 });
});

test('client throws on HTTP errors, network errors and malformed responses', async () => {
  const cases: Array<typeof fetch> = [
    fakeFetch(401, { error: 'Authentication is required.' }),
    fakeFetch(500, { error: 'Unable to load committed demand.' }),
    fakeFetch(200, { deliveryDate: '2026-10-24', committedDemandGrams: 0 }), // wrong date
    fakeFetch(200, { deliveryDate: '2026-10-17' }), // missing total
    (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch,
  ];
  for (const fetchImpl of cases) {
    await assert.rejects(requestCommittedDemand({ fetchImpl, idToken: 't', deliveryDate: '2026-10-17', productIds: [BROCCOLI] }), { message: COMMITTED_DEMAND_UNAVAILABLE });
  }
});

test('a committed-demand failure stops date resolution, so checkout cannot proceed as if available', async () => {
  let decided = false;
  await assert.rejects(
    resolveDeliveryDatesWithContexts(
      [{ key: `one-time:${broccoli106.id}`, kind: 'one-time', product: broccoli106, quantity: 1, packagingGrams: 100, requestedDate: '2026-10-17', name: broccoli106.name }],
      async () => {
        await requestCommittedDemand({ fetchImpl: fakeFetch(500, { error: 'Unable to load committed demand.' }), idToken: 't', deliveryDate: '2026-10-17', productIds: [BROCCOLI] });
        decided = true;
        throw new Error('unreachable');
      },
      { maxWeeks: 2, searchAfterHighDemand: true, defaultRequestedDate: '2026-10-17' },
    ).then(() => { decided = true; }),
    { message: COMMITTED_DEMAND_UNAVAILABLE },
  );
  assert.equal(decided, false);
});

test('client calls fetch unbound, as browsers require (regression: "Illegal invocation")', async () => {
  // Browser fetch throws when invoked with an object `this`, e.g. `args.fetchImpl(...)`.
  const browserLikeFetch = function (this: unknown, _url: string) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    return Promise.resolve(new Response(JSON.stringify({ deliveryDate: '2026-10-17', subscriptionCommitted: {}, oneTimeCommitted: {}, committedDemandGrams: 0 }), { status: 200 }));
  } as unknown as typeof fetch;
  const totals = await requestCommittedDemand({ fetchImpl: browserLikeFetch, idToken: 't', deliveryDate: '2026-10-17', productIds: [BROCCOLI] });
  assert.equal(totals.committedDemandGrams, 0);
});

