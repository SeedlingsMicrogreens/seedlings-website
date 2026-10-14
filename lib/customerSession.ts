/**
 * Customer vs. guest Firebase sessions (SYSTEM-INTEGRATION.md §13 "Customer
 * ownership", item 5). Customers sign in with the OTP custom token; anonymous
 * sessions are guest-only (Contact page) and must never replace or impersonate
 * a customer session.
 */

type SessionUser = { isAnonymous?: boolean } | null | undefined;

/** A guest (anonymous) session may be started only when there is no session and no customer is remembered. */
export function mayStartGuestSession(user: SessionUser, storedCustomerMobile: string) {
  return !user && !storedCustomerMobile;
}
