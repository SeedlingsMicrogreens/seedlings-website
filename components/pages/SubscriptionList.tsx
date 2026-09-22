import type { HTMLAttributes } from "react";

export type SubscriptionListProps = HTMLAttributes<HTMLElement>;

export function SubscriptionList(props: SubscriptionListProps) {
  return <section {...props} />;
}
