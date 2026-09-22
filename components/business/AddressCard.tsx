import type { HTMLAttributes } from "react";

/**
 * Shared Address Card boundary.
 *
 * Existing address selection/edit/add behavior remains unchanged. This is
 * only the reusable React boundary for the later address migration.
 */
export type AddressCardProps = HTMLAttributes<HTMLElement>;

export function AddressCard(props: AddressCardProps) {
  return <article {...props} />;
}
