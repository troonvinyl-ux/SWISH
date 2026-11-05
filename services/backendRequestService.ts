import { getSupabaseClient } from '@/template';
import { isBackendUnavailable } from './backendAvailabilityService';

export type ReadPriority = 'access' | 'foreground' | 'background';
const priorities: Record<ReadPriority, number> = { access: 0, foreground: 1, background: 2 };
const flights = new Map<string, Promise<unknown>>();
const failures = new Map<string, { until: number; attempts: number; message: string }>();
const clients = new WeakMap<object, number>();
let clientNumber = 0;
let active = 0;
interface Job { priority: number; start: () => void; expired: () => boolean }
const queue: Job[] = [];

/** No new client, persisted access cache or credential logging. Session identity is part of every flight. */
async function readScope(): Promise<string> {
  const client = getSupabaseClient();
  if (!clients.has(client)) clients.set(client, ++clientNumber);
  const session = client.auth ? await client.auth.getSession() : null;
  if (session?.error) throw new Error(session.error.message);
  // Client identity isolates test doubles; production additionally binds the existing auth session.
  return `${clients.get(client)}:${session?.data.session?.access_token ?? 'no-session'}`;
}
function pump() {
  queue.sort((a, b) => a.priority - b.priority);
  while (active < 2 && queue.length) {
    const job = queue.shift()!;
    if (!job.expired()) { active++; job.start(); }
  }
}
export function backendReadsBusy(): boolean { return active > 0 || queue.length > 0; }

/** Share work only while pending; never reuse an earlier authorization decision as a new grant. */
export async function shareBackendRequest<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const scope = await readScope();
  const scopedKey = `${scope}:${key}`;
  const existing = flights.get(scopedKey);
  if (existing) return existing as Promise<T>;
  const request = Promise.resolve().then(operation);
  flights.set(scopedKey, request);
  try { return await request; }
  finally { if (flights.get(scopedKey) === request) flights.delete(scopedKey); }
}

/** Bounded READ/RPC only. Every PostgREST caller must pass the signal to abortSignal().
 * No automatic retries, no mutation replay. Queue waits count toward the deadline.
 * HTTP abort cannot guarantee SQL cancellation on OnSpace: server statement_timeout is still required.
 */
export async function backendRead<T>(key: string, operation: (signal: AbortSignal) => PromiseLike<T>, priority: ReadPriority = 'foreground', timeoutMs = 12000): Promise<T> {
  const scope = await readScope();
  return shareBackendRequest(`read:${key}`, async () => {
    const scopedKey = `${scope}:${key}`;
    const failure = failures.get(scopedKey);
    if (failure && Date.now() < failure.until) throw new Error(failure.message);
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      let finished = false;
      let started = false;
      const settle = (error?: Error, value?: T) => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        if (started) active--;
        else { const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1); }
        if (error) {
          if (isBackendUnavailable(error.message)) {
            const attempts = Math.min(4, (failure?.attempts ?? 0) + 1);
            failures.set(scopedKey, { attempts, until: Date.now() + Math.min(60000, 5000 * 2 ** (attempts - 1)), message: error.message });
          } else failures.delete(scopedKey);
          reject(error);
        } else { failures.delete(scopedKey); resolve(value as T); }
        // Bound the failure registry without retaining successful results or access grants.
        if (failures.size > 128) for (const [id, entry] of failures) if (entry.until < Date.now()) failures.delete(id);
        pump();
      };
      const job: Job = {
        priority: priorities[priority], expired: () => finished,
        start: () => {
          started = true;
          void Promise.resolve().then(() => operation(controller.signal)).then(async value => {
            if (finished) return;
            const result = value as { error?: { message?: string; code?: string; context?: Response }; status?: number };
            if (result?.error) {
              let message = result.error.message ?? 'Backend read failed';
              const status = result.error.context?.status ?? result.status;
              if (result.error.context?.text) {
                try { const text = await result.error.context.text(); if (text) message = text.slice(0, 500); } catch { /* retain transport error */ }
              }
              throw new Error(`${status ? `[${status}] ` : ''}${result.error.code ? `${result.error.code}: ` : ''}${message}`);
            }
            if (await readScope() !== scope) throw new Error('Authenticated session changed during backend read.');
            settle(undefined, value);
          }).catch(cause => settle(cause instanceof Error ? cause : new Error('Backend read failed')));
        },
      };
      const timer = setTimeout(() => {
        controller.abort();
        settle(new Error('Backend request timed out. Wait briefly before retrying; no authorization decision was returned.'));
      }, timeoutMs);
      queue.push(job); pump();
    });
  });
}
