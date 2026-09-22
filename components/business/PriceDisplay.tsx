import type { HTMLAttributes } from "react";

/**
 * Shared price-display boundary.
 *
 * This component does not calculate price, discounts, delivery charges, or
 * payment amounts. Existing pricing logic remains the source of truth.
 */
export type PriceDisplayProps = HTMLAttributes<HTMLSpanElement>;

export function PriceDisplay(props: PriceDisplayProps) {
  return <span {...props} />;
}
