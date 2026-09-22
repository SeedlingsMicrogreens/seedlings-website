import type { HTMLAttributes } from "react";

export type SectionHeaderProps = HTMLAttributes<HTMLDivElement>;

export function SectionHeader(props: SectionHeaderProps) {
  return <div {...props} />;
}
