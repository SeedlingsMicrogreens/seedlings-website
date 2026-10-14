import { FieldValue } from 'firebase-admin/firestore';

/**
 * In-memory Firestore with the Admin SDK semantics the payment code relies on:
 * - `set(data)` replaces; `set(data, { merge: true })` deep-merges maps;
 *   `set(data, { mergeFields })` replaces exactly the listed top-level fields;
 *   `update(data)` replaces the given top-level fields (document must exist);
 * - `FieldValue.delete()` removes a field; `serverTimestamp()` stores a Date;
 *   `undefined` values are rejected when the write is queued;
 * - batches apply atomically on commit (optionally failing once);
 * - transactions are serialized (Firestore's serializable isolation for the
 *   documents involved) and apply their writes only if the callback succeeds;
 * - queries support `==`, `array-contains` and `in` on top-level fields.
 */

type Data = Record<string, unknown>;
type SetOptions = { merge?: boolean; mergeFields?: string[] };

const DELETE = FieldValue.delete();
const SERVER_TIMESTAMP = FieldValue.serverTimestamp();

function isPlainObject(value: unknown): value is Data {
  return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function isSentinel(value: unknown, sentinel: FieldValue) {
  return value instanceof FieldValue && value.isEqual(sentinel);
}

function assertNoUndefined(value: unknown, path: string) {
  if (value === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${path}").`);
  if (Array.isArray(value)) value.forEach((item, index) => assertNoUndefined(item, `${path}.${index}`));
  else if (isPlainObject(value)) for (const [key, item] of Object.entries(value)) assertNoUndefined(item, path ? `${path}.${key}` : key);
}

/** Resolves sentinels in a value written as a whole (no merging below it). */
function materialize(value: unknown): unknown {
  if (isSentinel(value, SERVER_TIMESTAMP)) return new Date();
  if (Array.isArray(value)) return value.map(materialize);
  if (isPlainObject(value)) {
    const out: Data = {};
    for (const [key, item] of Object.entries(value)) if (!isSentinel(item, DELETE)) out[key] = materialize(item);
    return out;
  }
  return value;
}

function deepMerge(target: Data, source: Data): Data {
  const out: Data = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (isSentinel(value, DELETE)) delete out[key];
    else if (isPlainObject(value) && isPlainObject(out[key])) out[key] = deepMerge(out[key] as Data, value);
    else out[key] = materialize(value);
  }
  return out;
}

export class FakeFirestore {
  docs = new Map<string, Data>();
  commits = 0;
  failNextCommit = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(seed: Record<string, Data> = {}) {
    for (const [path, data] of Object.entries(seed)) this.docs.set(path, structuredClone(data));
  }

  private applySet(path: string, data: Data, options: SetOptions = {}) {
    const current = this.docs.get(path);
    if (options.mergeFields) {
      const next: Data = { ...(current || {}) };
      for (const field of options.mergeFields) {
        if (!(field in data) || isSentinel(data[field], DELETE)) delete next[field];
        else next[field] = materialize(data[field]);
      }
      this.docs.set(path, next);
    } else if (options.merge) {
      this.docs.set(path, deepMerge(current || {}, data));
    } else {
      this.docs.set(path, materialize(data) as Data);
    }
  }

  private applyUpdate(path: string, data: Data) {
    const current = this.docs.get(path);
    if (!current) throw new Error(`No document to update: ${path}`);
    const next: Data = { ...current };
    for (const [field, value] of Object.entries(data)) {
      if (isSentinel(value, DELETE)) delete next[field];
      else next[field] = materialize(value);
    }
    this.docs.set(path, next);
  }

  private snapshot(path: string) {
    const data = this.docs.get(path);
    return { id: path.split('/').pop()!, exists: Boolean(data), ref: this.ref(path), data: () => (data ? structuredClone(data) : undefined) };
  }

  ref(path: string) {
    return {
      id: path.split('/').pop()!,
      path,
      get: async () => this.snapshot(path),
      set: async (data: Data, options?: SetOptions) => { assertNoUndefined(data, ''); this.applySet(path, data, options); },
      update: async (data: Data) => { assertNoUndefined(data, ''); this.applyUpdate(path, data); },
      delete: async () => { this.docs.delete(path); },
    };
  }

  doc(path: string) { return this.ref(path); }

  collection(name: string) {
    const query = (filters: Array<[string, string, unknown]>) => ({
      where: (field: string, op: string, value: unknown) => query([...filters, [field, op, value]]),
      get: async () => {
        const docs = [...this.docs.entries()]
          .filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === 2)
          .filter(([, data]) => filters.every(([field, op, value]) => {
            const actual = data[field];
            if (op === '==') return actual === value;
            if (op === 'array-contains') return Array.isArray(actual) && actual.includes(value);
            if (op === 'in') return Array.isArray(value) && value.includes(actual);
            throw new Error(`Unsupported operator ${op}`);
          }))
          .map(([path]) => this.snapshot(path));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    });
    return { doc: (id: string) => this.ref(`${name}/${id}`), ...query([]) };
  }

  async getAll(...refs: Array<{ path: string }>) {
    return refs.map((ref) => this.snapshot(ref.path));
  }

  runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (ref: { path: string }) => this.snapshot(ref.path),
        set: (ref: { path: string }, data: Data, options?: SetOptions) => { assertNoUndefined(data, ''); writes.push(() => this.applySet(ref.path, data, options)); },
        update: (ref: { path: string }, data: Data) => { assertNoUndefined(data, ''); writes.push(() => this.applyUpdate(ref.path, data)); },
        delete: (ref: { path: string }) => { writes.push(() => { this.docs.delete(ref.path); }); },
      };
      const result = await fn(tx);
      writes.forEach((write) => write());
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  batch() {
    const ops: Array<() => void> = [];
    return {
      set: (ref: { path: string }, data: Data, options?: SetOptions) => { assertNoUndefined(data, ''); ops.push(() => this.applySet(ref.path, data, options)); },
      update: (ref: { path: string }, data: Data) => { assertNoUndefined(data, ''); ops.push(() => this.applyUpdate(ref.path, data)); },
      delete: (ref: { path: string }) => { ops.push(() => { this.docs.delete(ref.path); }); },
      commit: async () => {
        if (this.failNextCommit) { this.failNextCommit = false; throw new Error('commit failed'); }
        // Atomic: validate every operation against a copy first.
        const snapshot = new Map(this.docs);
        try { ops.forEach((op) => op()); } catch (error) { this.docs = snapshot; throw error; }
        this.commits += 1;
      },
    };
  }

  get(path: string) { return this.docs.get(path); }
  pathsUnder(prefix: string) { return [...this.docs.keys()].filter((path) => path.startsWith(prefix)); }
  under(prefix: string) { return [...this.docs.entries()].filter(([path]) => path.startsWith(prefix)).map(([path, data]) => ({ path, data })); }
}
