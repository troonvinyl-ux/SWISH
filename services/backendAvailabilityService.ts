/** A transient failure is not an authorization decision. Server RLS remains mandatory. */
export function isBackendUnavailable(message: unknown): boolean {
  const text = typeof message === 'string' ? message : '';
  if (/\[(?:401|402|403)\]|\b42501\b|access denied|entitlement required|invalid or expired authentication|session changed|scope mismatch/i.test(text)) return false;
  return /connection pool|acquiring connection|pool timeout|gateway timeout|timed out|timeout|network request failed|failed to fetch|could not be reached|could not reach|HTTP (?:499|502|503|504)|\[(?:499|502|503|504)\]|\[Code: (?:499|502|503|504)\]|service unavailable|\b57014\b|temporarily unavailable/i.test(text);
}
export function describeAccessFailure(message: string | null | undefined) {
  return isBackendUnavailable(message)
    ? { title: 'SWISH backend temporarily unavailable', message: 'The backend could not provide a connection in time. This does not mean your account is unverified. Access remains protected; wait briefly, then retry.', retryLabel: 'Retry connection' }
    : { title: 'Account verification required', message: message || 'Your memberships have not been verified.', retryLabel: 'Retry verification' };
}
