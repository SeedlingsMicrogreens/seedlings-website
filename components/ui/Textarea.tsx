import type { TextareaHTMLAttributes } from "react";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea(props: TextareaProps) {
  return <textarea {...props} />;
}
