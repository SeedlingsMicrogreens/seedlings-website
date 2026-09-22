import type { HTMLAttributes } from "react";

/**
 * Checkout page standardization boundary.
 *
 * This component is intentionally structural. Checkout business logic,
 * payment state, inventory handling, address selection and order creation
 * remain in the existing checkout implementation until each section is
 * migrated and verified.
 */
export type CheckoutPageProps = HTMLAttributes<HTMLElement>;

export function CheckoutPage(props: CheckoutPageProps) {
  return <main {...props} />;
}
