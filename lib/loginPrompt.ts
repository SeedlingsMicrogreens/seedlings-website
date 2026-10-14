/**
 * The single way the site asks a customer to sign in automatically
 * (SYSTEM-INTEGRATION.md §13 "Customer ownership", item 7). Only an absent
 * session or an `unauthenticated` API answer (after the forced token refresh)
 * may prompt; profile, network and payment-record problems never do. A prompt
 * opens at most once per page for the same reason, and each one logs a
 * sanitized `[auth-prompt]` line (component and reason only — never a mobile,
 * UID or token) so a real-browser occurrence can be traced in the dev log.
 * A customer's own click on a "Sign in" button opens the modal directly.
 */

export type LoginPromptReason = 'session_absent' | 'api_unauthenticated';

export function createLoginPrompter(deps: {
  open: (redirectTo: string | null) => void;
  log: (line: string) => void;
}) {
  const prompted = new Set<string>();
  return (component: string, reason: LoginPromptReason, redirectTo: string | null = null) => {
    deps.log(`[auth-prompt] component=${component} reason=${reason}`);
    if (prompted.has(reason)) return false;
    prompted.add(reason);
    deps.open(redirectTo);
    return true;
  };
}

/** Browser prompter (one per page load). */
export const requestLogin = createLoginPrompter({
  open: (redirectTo) => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('seedlings-open-login', { detail: { redirectTo } }));
  },
  log: (line) => { if (typeof console !== 'undefined') console.warn(line); },
});
