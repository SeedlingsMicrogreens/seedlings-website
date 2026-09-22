import type { HTMLAttributes } from "react";

/**
 * Account/Profile/Addresses standardization boundary.
 *
 * Existing authentication, customer data, address services and page behavior
 * remain the source of truth. This boundary is used for controlled,
 * page-by-page React migration without changing UX/UI.
 */
export type AccountPageProps = HTMLAttributes<HTMLElement>;

export function AccountPage(props: AccountPageProps) {
  return <main {...props} />;
}
