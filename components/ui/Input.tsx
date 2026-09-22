import type { InputHTMLAttributes } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input(props: InputProps) {
  return <input {...props} />;
}
