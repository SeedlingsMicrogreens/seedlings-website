import type { InputHTMLAttributes } from "react";

export type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function Radio({ name, ...props }: RadioProps) {
  return <input type="radio" name={name} {...props} />;
}
