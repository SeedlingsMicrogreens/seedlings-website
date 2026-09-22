import type { HTMLAttributes } from "react";

/**
 * Shared mobile-navigation boundary.
 *
 * Existing mobile navigation remains untouched in Phase 2. This component is
 * only the standardized React boundary for later page/layout migration.
 */
export type MobileNavProps = HTMLAttributes<HTMLElement>;

export function MobileNav(props: MobileNavProps) {
  return <nav {...props} />;
}
