export interface LogoutResult { error: string | null }

/** Normalise the existing AuthProvider logout operation without leaking SDK diagnostics. */
export async function logoutAccount(operation: () => Promise<unknown>): Promise<LogoutResult> {
  try {
    const response = await operation();
    if (response == null || typeof response !== 'object') {
      return { error: 'Sign out was not confirmed. Check your connection and try again.' };
    }
    const error = (response as { error?: unknown }).error;
    if (error) return { error: typeof error === 'string' ? error : 'Check your connection and try again.' };
    return { error: null };
  } catch {
    return { error: 'Check your connection and try again.' };
  }
}
