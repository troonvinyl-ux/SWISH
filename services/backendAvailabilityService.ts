/** Presentation only. A transient backend failure NEVER grants or extends access. */
export function isBackendUnavailable(message: unknown): boolean {
  const text = typeof message === 'string' ? message : '';
  return /connection pool|acquiring connection|pool timeout|gateway timeout|timed out|timeout|network request failed|failed to fetch|could not be reached|could not reach|HTTP (?:502|503|504)|\[(?:502|503|504)\]|service unavailable/i.test(text);
}
export function describeAccessFailure(message: string | null | undefined) {
  const detail = message || 'Your memberships have not been verified.';
  if (/schema cache|could not find the function|function .* does not exist|pgrst202/i.test(detail)) {
    return { title: 'SWISH backend needs a database update', message: 'A required SWISH database function is missing or its API schema cache is stale. This is a backend configuration issue, not proof that your eBay account or membership is invalid. Ask the SWISH administrator to apply the pending migration and refresh the database schema cache.', retryLabel: 'Retry after backend update' };
  }
  return isBackendUnavailable(message)
    ? { title: 'SWISH backend temporarily unavailable', message: 'The backend could not provide a connection in time. This does not mean your account is unverified. Access remains protected; wait briefly, then retry.', retryLabel: 'Retry connection' }
    : { title: 'Account verification required', message: detail, retryLabel: 'Retry verification' };
}
