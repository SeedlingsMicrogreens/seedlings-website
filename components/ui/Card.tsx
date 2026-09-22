import type { HTMLAttributes } from "react";

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card(props: CardProps) {
  return <div {...props} />;
}
