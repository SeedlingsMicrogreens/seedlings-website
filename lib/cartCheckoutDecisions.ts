import type { AvailabilityResult } from './customerAvailabilityMath';

export type CheckoutDecisionItem = {
  key: string;
  requestedDate: string;
  deliveryDate: string | null;
};

export type ShortageDecision = 'continue' | 'contact' | 'cancel';

export type CheckoutShortagePlan<T extends CheckoutDecisionItem> =
  | { outcome: 'high-demand'; item: T; availability: AvailabilityResult }
  | { outcome: 'contact'; item: T; availability: AvailabilityResult }
  | { outcome: 'cancel'; item: T; availability: AvailabilityResult }
  | { outcome: 'continue'; acceptedKeys: Set<string>; pendingItems: T[] };

/**
 * Runs the per-item shortage decisions for Proceed to Checkout, in cart order,
 * before any generic delivery-date handling:
 * - high demand (threshold fallback exceeded) stops at the enquiry flow;
 * - a shortage always asks the customer: with a later full-quantity date the
 *   customer may accept it; without one only enquiry or keep-in-cart remain;
 * - an accepted later date is not asked again by the generic popup.
 * Later dates not covered by a shortage decision are returned as
 * `pendingItems` for the generic popup.
 */
export async function planCheckoutShortageDecisions<T extends CheckoutDecisionItem>(
  items: T[],
  deps: {
    checkAvailability: (item: T) => Promise<AvailabilityResult | null>;
    confirmShortage: (item: T, availability: AvailabilityResult) => Promise<ShortageDecision>;
  },
): Promise<CheckoutShortagePlan<T>> {
  const acceptedKeys = new Set<string>();
  for (const item of items) {
    const availability = await deps.checkAvailability(item);
    if (!availability || (!availability.hasShortage && !availability.highDemand)) continue;
    if (availability.highDemand) return { outcome: 'high-demand', item, availability };
    const decision = await deps.confirmShortage(item, availability);
    if (decision === 'contact') return { outcome: 'contact', item, availability };
    // A later date can only be accepted when one exists.
    if (decision === 'cancel' || !item.deliveryDate) return { outcome: 'cancel', item, availability };
    acceptedKeys.add(item.key);
  }
  const pendingItems = items.filter((item) => item.deliveryDate !== item.requestedDate && !acceptedKeys.has(item.key));
  return { outcome: 'continue', acceptedKeys, pendingItems };
}
