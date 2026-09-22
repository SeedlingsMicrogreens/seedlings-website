import type { HTMLAttributes } from "react";

/**
 * Shared page-shell boundary.
 * Existing pages keep their current implementation until their individual
 * migration phase.
 */
export type PageShellProps = HTMLAttributes<HTMLElement>;

export function PageShell(props: PageShellProps) {
  return <main {...props} />;
}
