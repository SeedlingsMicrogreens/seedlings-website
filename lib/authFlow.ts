type AuthLike = {
  currentUser?: unknown | null;
  authStateReady?: () => Promise<void>;
};

export async function waitForCustomerAuthReady(
  authInstance: AuthLike | null | undefined,
  timeoutMs = 5000,
): Promise<boolean> {
  if (!authInstance || authInstance.currentUser) return Boolean(authInstance?.currentUser);

  const authReady = typeof authInstance.authStateReady === 'function'
    ? authInstance.authStateReady.bind(authInstance)
    : null;

  if (!authReady) return false;

  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

  try {
    await Promise.race([
      authReady(),
      new Promise<void>((_, reject) => {
        timeoutId = globalThis.setTimeout(() => reject(new Error('Auth initialization timed out.')), timeoutMs);
      }),
    ]);
    return Boolean(authInstance.currentUser);
  } catch {
    return Boolean(authInstance.currentUser);
  } finally {
    if (timeoutId) globalThis.clearTimeout(timeoutId);
  }
}
