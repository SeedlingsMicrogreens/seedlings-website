import type { HTMLAttributes } from "react";

export function LoadingState(props: HTMLAttributes<HTMLDivElement>) {
  return <div role="status" {...props} />;
}

export function EmptyState(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}

export function ErrorState(props: HTMLAttributes<HTMLDivElement>) {
  return <div role="alert" {...props} />;
}
