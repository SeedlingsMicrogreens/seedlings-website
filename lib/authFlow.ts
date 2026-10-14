type AuthLike = {
  currentUser?: { isAnonymous?: boolean } | null;
  authStateReady?: () => Promise<void>;
};

/** A customer session is a non-anonymous Firebase user (anonymous sessions are guest-only). */
const isCustomer = (user: AuthLike['currentUser']) => Boolean(user && !user.isAnonymous);

export async function waitForCustomerAuthReady(
  authInstance: AuthLike | null | undefined,
): Promise<boolean> {
  if (!authInstance || authInstance.currentUser) return isCustomer(authInstance?.currentUser);

  const authReady = typeof authInstance.authStateReady === 'function'
    ? authInstance.authStateReady.bind(authInstance)
    : null;

  if (!authReady) return false;

  try {
    await authReady();
  } catch {
    return isCustomer(authInstance.currentUser);
  }
  return isCustomer(authInstance.currentUser);
}
