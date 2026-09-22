import type { HTMLAttributes } from "react";

/**
 * Orders page standardization boundary.
 *
 * The existing order data/services, status mapping, ownership checks and
 * navigation remain the source of truth. This boundary is used for the
 * controlled Orders-page migration and does not change order behavior.
 */
export type OrdersPageProps = HTMLAttributes<HTMLElement>;

export function OrdersPage(props: OrdersPageProps) {
  return <main {...props} />;
}
