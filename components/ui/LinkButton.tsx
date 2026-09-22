import type { AnchorHTMLAttributes } from "react";

export type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement>;

export function LinkButton(props: LinkButtonProps) {
  return <a {...props} />;
}
