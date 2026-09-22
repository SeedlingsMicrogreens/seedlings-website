import type { HTMLAttributes } from "react";

/**
 * Shared quantity-control boundary.
 *
 * Inventory and cart mutation behavior remain in existing business logic.
 */
export type QuantityControlProps = HTMLAttributes<HTMLDivElement>;

export function QuantityControl(props: QuantityControlProps) {
  return <div {...props} />;
}
