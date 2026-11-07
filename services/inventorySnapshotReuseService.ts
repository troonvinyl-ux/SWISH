// Ephemeral DATA cache, not an authorization cache. Callers must first complete a fresh authorized count RPC.
// Session identity + tenant + niche are supplied by the existing client. No device persistence.
import { recordPrevention } from './performanceMonitoringService';
interface Entry<T> { revision: string; value: T; savedAt: number }
const entries = new Map<string, Entry<unknown>>();
const maxAge = 5 * 60 * 1000;
export function readUnchangedInventory<T>(scope: string, revision: string | null): T | null {
 const entry = entries.get(scope);
 if (!revision || !entry || entry.revision !== revision || Date.now() - entry.savedAt > maxAge) { entries.delete(scope); return null; }
 recordPrevention('unchanged_inventory');
 return entry.value as T;
}
export function rememberInventory<T>(scope: string, revision: string | null, value: T): void {
 if (!revision) return;
 entries.delete(scope); entries.set(scope, { revision, value, savedAt: Date.now() });
 for (const [key, entry] of entries) if (Date.now() - entry.savedAt > maxAge) entries.delete(key);
 while (entries.size > 4) entries.delete(entries.keys().next().value!);
}
export function forgetInventory(scope: string) { entries.delete(scope); }
