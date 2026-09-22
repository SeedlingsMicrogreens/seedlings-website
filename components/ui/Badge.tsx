import type { HTMLAttributes } from "react";

export type BadgeProps = HTMLAttributes<HTMLSpanElement>;

export function Badge(props: BadgeProps) {
  return <span {...props} />;
}
