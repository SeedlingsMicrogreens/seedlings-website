import type { HTMLAttributes } from "react";

/**
 * Shared Cart Item boundary.
 *
 * No cart calculation, inventory, quantity, pricing, or checkout behavior
 * is implemented here. Those remain in the existing working flow.
 */
export type CartItemProps = HTMLAttributes<HTMLElement>;

export function CartItem(props: CartItemProps) {
  return <article {...props} />;
}
