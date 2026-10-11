import type { CartDeliveryResolutionItem } from './customerAvailabilityMath';

/** Cart checkout checks the requested delivery date and exactly one subsequent date. */
export const CART_DELIVERY_DATES_CHECKED = 2;

/** The single subsequent delivery date checked after the requested date (same weekday, +7 days). */
export function nextDeliveryDateAfter(date: string) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + 7);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** Enquiry reason from the final outcome of the date check (existing reason types). */
export function enquiryReasonFor(item: Pick<CartDeliveryResolutionItem, 'highDemand'>): 'HIGH_DEMAND' | 'AVAILABILITY_SHORTAGE' {
  return item.highDemand ? 'HIGH_DEMAND' : 'AVAILABILITY_SHORTAGE';
}

export function partitionCartResolution<T extends CartDeliveryResolutionItem>(items: T[]) {
  return {
    onTime: items.filter((item) => item.deliveryDate !== null && item.deliveryDate === item.requestedDate),
    nextDate: items.filter((item) => item.deliveryDate !== null && item.deliveryDate !== item.requestedDate),
    unavailable: items.filter((item) => item.deliveryDate === null),
  };
}

export type CartCheckoutOutcome =
  | { outcome: 'checkout'; dates: Record<string, string> }
  | { outcome: 'stay'; reason: 'enquiry-declined' }
  | { outcome: 'stay'; reason: 'enquiry-failed'; error: unknown }
  | { outcome: 'stay'; reason: 'all-items-enquired'; declinedNextDate: boolean };

function datesFor(items: CartDeliveryResolutionItem[]) {
  return Object.fromEntries(items.map((item) => [item.key, item.deliveryDate as string]));
}

/**
 * Proceed to Checkout decision flow after the requested-date + next-date check:
 * 1. Items unavailable on both dates: existing enquiry popup. Send Enquiry saves
 *    the enquiries and those items leave the cart; declining stays on Cart.
 * 2. Items available only on the next date: high-demand dates popup.
 *    Yes keeps the displayed dates; No saves an enquiry for every next-date item
 *    (removing each as soon as it is saved) and continues with requested-date items.
 * 3. Remaining items open Checkout with their dates; with none left, stay on Cart.
 * A failed enquiry save stops the flow so nothing proceeds as if it succeeded.
 */
export async function runCartCheckoutDecision<T extends CartDeliveryResolutionItem>(
  items: T[],
  deps: {
    /** Existing enquiry popup for unavailable items. Resolves false when declined; throws when saving fails. */
    enquireUnavailable: (items: T[]) => Promise<boolean>;
    /** High-demand dates popup. Resolves true for Yes, false for No. */
    confirmNextDates: (allAvailable: T[]) => Promise<boolean>;
    /** Saves the enquiry for one declined next-date item; throws when saving fails. */
    saveDeclinedEnquiry: (item: T) => Promise<void>;
    removeFromCart: (item: T) => void;
  },
): Promise<CartCheckoutOutcome> {
  const { onTime, nextDate, unavailable } = partitionCartResolution(items);

  if (unavailable.length) {
    let submitted: boolean;
    try {
      submitted = await deps.enquireUnavailable(unavailable);
    } catch (error) {
      return { outcome: 'stay', reason: 'enquiry-failed', error };
    }
    if (!submitted) return { outcome: 'stay', reason: 'enquiry-declined' };
    for (const item of unavailable) deps.removeFromCart(item);
  }

  if (nextDate.length) {
    const accepted = await deps.confirmNextDates([...onTime, ...nextDate].sort((a, b) => items.indexOf(a) - items.indexOf(b)));
    if (accepted) return { outcome: 'checkout', dates: datesFor([...onTime, ...nextDate]) };
    for (const item of nextDate) {
      try {
        await deps.saveDeclinedEnquiry(item);
      } catch (error) {
        return { outcome: 'stay', reason: 'enquiry-failed', error };
      }
      deps.removeFromCart(item);
    }
    if (!onTime.length) return { outcome: 'stay', reason: 'all-items-enquired', declinedNextDate: true };
    return { outcome: 'checkout', dates: datesFor(onTime) };
  }

  if (!onTime.length) return { outcome: 'stay', reason: 'all-items-enquired', declinedNextDate: false };
  return { outcome: 'checkout', dates: datesFor(onTime) };
}
