import type { HTMLAttributes } from "react";

/**
 * Shared Order Card boundary.
 *
 * Order/payment state handling remains in existing application logic.
 */
export type OrderCardProps = HTMLAttributes<HTMLElement>;

export function OrderCard(props: OrderCardProps) {
  return <article {...props} />;
}
