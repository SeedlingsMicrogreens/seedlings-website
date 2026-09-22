import type { HTMLAttributes } from "react";

/**
 * Shared Subscription Card boundary.
 *
 * Product-to-subscription mapping and subscription business rules remain in
 * the existing services/flows.
 */
export type SubscriptionCardProps = HTMLAttributes<HTMLElement>;

export function SubscriptionCard(props: SubscriptionCardProps) {
  return <article {...props} />;
}
