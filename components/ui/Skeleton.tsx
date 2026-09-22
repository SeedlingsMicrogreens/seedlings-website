import type { HTMLAttributes } from "react";

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

export function Skeleton(props: SkeletonProps) {
  return <div aria-hidden="true" {...props} />;
}
