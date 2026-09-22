import type { HTMLAttributes } from "react";

/**
 * Shared semantic page-section boundary.
 * Styling is intentionally inherited so existing UX/UI is not changed.
 */
export type PageSectionProps = HTMLAttributes<HTMLElement>;

export function PageSection(props: PageSectionProps) {
  return <section {...props} />;
}
