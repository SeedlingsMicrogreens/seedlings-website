/**
 * Browser client for `/api/customer/committed-demand`. Any failure throws, so
 * callers never treat availability as confirmed without the server totals.
 */
export type CommittedDemandTotals = {
  subscriptionCommitted: Record<string, number>;
  oneTimeCommitted: Record<string, number>;
  committedDemandGrams: number;
};

export const COMMITTED_DEMAND_UNAVAILABLE = 'We could not check product availability right now. Please try again.';

function gramsMap(value: unknown, productIds: string[]) {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result: Record<string, number> = {};
  for (const id of productIds) {
    const grams = Number(source[id]);
    if (Number.isFinite(grams) && grams > 0) result[id] = grams;
  }
  return result;
}

export async function requestCommittedDemand(args: {
  fetchImpl: typeof fetch;
  idToken: string;
  deliveryDate: string;
  productIds: string[];
}): Promise<CommittedDemandTotals> {
  const params = new URLSearchParams({ deliveryDate: args.deliveryDate, productIds: args.productIds.join(',') });
  // Call fetch unbound: invoking it as `args.fetchImpl(...)` throws
  // "Illegal invocation" in browsers before any request is sent.
  const fetchImpl = args.fetchImpl;
  let response: Response;
  try {
    response = await fetchImpl(`/api/customer/committed-demand?${params.toString()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${args.idToken}` },
    });
  } catch {
    throw new Error(COMMITTED_DEMAND_UNAVAILABLE);
  }
  if (!response.ok) throw new Error(COMMITTED_DEMAND_UNAVAILABLE);
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  const total = Number(data?.committedDemandGrams);
  if (!data || data.deliveryDate !== args.deliveryDate || !Number.isFinite(total) || total < 0) throw new Error(COMMITTED_DEMAND_UNAVAILABLE);
  return {
    subscriptionCommitted: gramsMap(data.subscriptionCommitted, args.productIds),
    oneTimeCommitted: gramsMap(data.oneTimeCommitted, args.productIds),
    committedDemandGrams: total,
  };
}
