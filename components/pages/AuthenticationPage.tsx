import type { HTMLAttributes } from "react";

/**
 * Authentication standardization boundary.
 *
 * This component is intentionally presentation-only. Existing Firebase
 * authentication/session services and auth flows remain the source of truth.
 */
export type AuthenticationPageProps = HTMLAttributes<HTMLElement>;

export function AuthenticationPage(props: AuthenticationPageProps) {
  return <main {...props} />;
}
