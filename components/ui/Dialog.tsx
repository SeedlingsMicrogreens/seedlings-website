import type { HTMLAttributes } from "react";

export type DialogProps = HTMLAttributes<HTMLDivElement> & {
  open?: boolean;
};

export function Dialog({ open = true, ...props }: DialogProps) {
  if (!open) return null;
  return <div role="dialog" aria-modal="true" {...props} />;
}
