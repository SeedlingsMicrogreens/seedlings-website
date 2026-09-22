import type { HTMLAttributes } from "react";

/**
 * Shared layout boundary.
 * Phase 2 only establishes the component boundary; existing pages are not
 * migrated here, so their current spacing/width behavior remains unchanged.
 */
export type ContainerProps = HTMLAttributes<HTMLDivElement>;

export function Container(props: ContainerProps) {
  return <div {...props} />;
}
