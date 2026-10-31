import { getSupabaseClient } from '@/template';
import * as Crypto from 'expo-crypto';
import { WATCHED_LOT_BUCKET, WATCHED_LOT_MAX_BYTES, WATCHED_LOT_PAGE_SIZE, WATCHED_LOT_SNAPSHOT_VERSION } from '@/constants/watchedLots';
import { resolveProductionNiche } from './nicheRouting';
import { DEFAULT_LOT_ASSUMPTIONS, evaluateManifestLot, type LotLine } from './lotEconomicsService';
import { emptyManifestSession, type ManifestSession } from './manifestSessionService';
import type { LotBasePrice } from './lotBasePriceService';
import { normaliseAuctionUrl } from './auctionLinkService';

export interface WatchedLotScope { userId: string; tenantId: string; nicheId: string }
export interface WatchedLot {
  id: string; user_id: string; tenant_id: string; niche_id: string; manifest_key: string; name: string;
  product_count: number; unit_count: number; base_valuation: LotBasePrice; engine_version: string;
  snapshot_path: string; created_at: string; updated_at: string; auction_url?: string | null;
}
export type WatchedManifestDraft = Pick<ManifestSession, 'name' | 'key' | 'lines' | 'assumptions' | 'warnings' | 'strategy'> & { auctionUrl?: string }; 
export interface WatchedLotSnapshot {
  version: number; scope: WatchedLotScope; savedAt: string; engineVersion: string;
  draft: WatchedManifestDraft; base: LotBasePrice;
}
const fields = 'id,user_id,tenant_id,niche_id,manifest_key,name,product_count,unit_count,base_valuation,engine_version,snapshot_path,created_at,updated_at,auction_url';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const manifestKey = /^[a-f0-9]{64}$/;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === 'string');
export function watchedLotScopeKey(scope: WatchedLotScope): string { return `${scope.userId}:${scope.tenantId}:${scope.nicheId}`; }
export function validateWatchedLotScope(scope: WatchedLotScope): void {
  if (!uuid.test(scope.userId) || !uuid.test(scope.tenantId) || resolveProductionNiche(scope.nicheId) !== scope.nicheId) {
    throw new Error('Sign in and select a niche before watching a lot.');
  }
}
export function isWatchedLotInScope(row: WatchedLot, scope: WatchedLotScope): boolean {
  return row.user_id === scope.userId && row.tenant_id === scope.tenantId && row.niche_id === scope.nicheId;
}
export function watchedSnapshotPath(scope: WatchedLotScope, key: string, revision: string): string {
  validateWatchedLotScope(scope);
  if (!manifestKey.test(key) || !uuid.test(revision)) throw new Error('The saved lot reference is invalid.');
  return `${scope.userId}/${scope.tenantId}/${scope.nicheId}/${key}/${revision}.json`;
}
function validateLine(value: unknown): value is LotLine {
  if (!isObject(value)) return false;
  const strings = ['id','sku','lotSku','title','description','asin','eanRaw','ean','brand','category','subcategory','condition','grade','currency'];
  const numbers = ['sourceRow','quantity','weightKg','unitRrp','totalRrp','price','conservativePrice','packSize','packPrice'];
  return strings.every(key => typeof value[key] === 'string') && numbers.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
    && ['include','inspected','safetyConfirmed'].every(key => typeof value[key] === 'boolean')
    && ['rrp_assumption','user_scenario'].includes(String(value.priceSource))
    && stringArray(value.images) && stringArray(value.warnings)
    && (value.requiredSpecifics === undefined || stringArray(value.requiredSpecifics))
    && (value.specifics === undefined || (Array.isArray(value.specifics) && value.specifics.every(s => isObject(s) && typeof s.name === 'string' && typeof s.value === 'string')))
    && (value.categoryId === undefined || typeof value.categoryId === 'string')
    && (value.categoryName === undefined || typeof value.categoryName === 'string')
    && (value.taxonomyChecked === undefined || typeof value.taxonomyChecked === 'boolean');
}
function validateDraft(value: unknown): asserts value is WatchedManifestDraft {
  if (!isObject(value) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200
    || typeof value.key !== 'string' || !manifestKey.test(value.key) || !Array.isArray(value.lines)
    || value.lines.length < 1 || value.lines.length > 500 || !value.lines.every(validateLine)
    || !stringArray(value.warnings) || !['individual','grouped','whole'].includes(String(value.strategy)) || !isObject(value.assumptions)) {
    throw new Error('Check your list before saving it to watched lots.');
  }
  if (value.auctionUrl !== undefined && typeof value.auctionUrl !== 'string') throw new Error('Check your auction-page link.');
  normaliseAuctionUrl(value.auctionUrl as string | undefined);
  const assumptions = value.assumptions;
  for (const key of Object.keys(DEFAULT_LOT_ASSUMPTIONS)) {
    const number = assumptions[key];
    if (['currentBid','bidCount','minutesLeft'].includes(key) && number === null) continue;
    if (typeof number !== 'number' || !Number.isFinite(number)) throw new Error('Check the amounts in your plan before saving.');
  }
  const evaluation = evaluateManifestLot(value.lines as LotLine[], assumptions as unknown as ManifestSession['assumptions']);
  if (evaluation.errors.length || evaluation.base.status === 'invalid') throw new Error('Check your prices, quantities and costs before saving.');
}
function validateBase(value: unknown): value is LotBasePrice {
  if (!isObject(value)) return false;
  const keys = ['manifestRrp','eligibleRrp','resaleCeiling','landedPurchaseCeiling','maximumPurchasePrice','maximumHammerBid','delivery','buyingMultiplier'];
  return keys.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && (value[key] as number) >= 0)
    && (value.profitAtCurrentBid === null || typeof value.profitAtCurrentBid === 'number' && Number.isFinite(value.profitAtCurrentBid))
    && ['no_value','no_room','needs_bid','within_limit','above_limit'].includes(String(value.status));
}
export function createWatchedLotSnapshot(scope: WatchedLotScope, session: ManifestSession, savedAt = new Date().toISOString()): WatchedLotSnapshot {
  validateWatchedLotScope(scope);
  if (session.acquisitionId) throw new Error('This lot is already purchased. Open it in your stock instead.');
  // Explicit allowlist excludes actual paid prices, inventory and listing IDs.
  const { budget: _legacyBudget, ...assumptions } = session.assumptions;
  const draft: WatchedManifestDraft = { name: session.name.trim().slice(0,200), key: session.key, lines: session.lines,
    assumptions, warnings: session.warnings, strategy: session.strategy, auctionUrl: normaliseAuctionUrl(session.auctionUrl) };
  validateDraft(draft);
  const evaluation = evaluateManifestLot(draft.lines, draft.assumptions);
  return JSON.parse(JSON.stringify({ version: WATCHED_LOT_SNAPSHOT_VERSION, scope, savedAt,
    engineVersion: evaluation.engineVersion, draft, base: evaluation.base })) as WatchedLotSnapshot;
}
// Native-safe UTF-8 bytes: Storage upload accepts ArrayBuffer without file:// fetch or Blob support.
export function encodeWatchedLotSnapshot(snapshot: WatchedLotSnapshot): Uint8Array {
  const encoded = encodeURIComponent(JSON.stringify(snapshot));
  const raw = encoded.replace(/%([0-9A-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex,16)));
  if (raw.length > WATCHED_LOT_MAX_BYTES) throw new Error('This list is too large to watch. Split it into smaller lots.');
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}
export function decodeWatchedLotSnapshot(text: string, scope: WatchedLotScope, key: string): WatchedLotSnapshot {
  validateWatchedLotScope(scope);
  if (text.length > WATCHED_LOT_MAX_BYTES) throw new Error('This saved list is too large to open.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('This saved list could not be read. Your shortlist is unchanged.'); }
  if (!isObject(value) || value.version !== WATCHED_LOT_SNAPSHOT_VERSION || !isObject(value.scope)
    || value.scope.userId !== scope.userId || value.scope.tenantId !== scope.tenantId || value.scope.nicheId !== scope.nicheId
    || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)) || typeof value.engineVersion !== 'string' || !validateBase(value.base)) {
    throw new Error('This saved plan does not match your account and niche, or needs a newer app.');
  }
  validateDraft(value.draft);
  if (value.draft.key !== key) throw new Error('This saved plan does not match the selected lot.');
  // Strip unexpected purchase fields even if an older/tampered payload includes them.
  const { name, lines, assumptions, warnings, strategy, auctionUrl } = value.draft;
  return { version: value.version, scope, savedAt: value.savedAt, engineVersion: value.engineVersion,
    base: value.base, draft: { name, key, lines, assumptions, warnings, strategy, auctionUrl: normaliseAuctionUrl(auctionUrl) } };
}
export function restoreWatchedLotSession(snapshot: WatchedLotSnapshot): ManifestSession {
  return { ...emptyManifestSession(), ...snapshot.draft, auctionUrl: normaliseAuctionUrl(snapshot.draft.auctionUrl), restoredWatchAt: snapshot.savedAt, watchedBidNeedsRefresh: true };
}
export async function listWatchedLots(scope: WatchedLotScope, offset = 0): Promise<{ rows: WatchedLot[]; hasMore: boolean }> {
  validateWatchedLotScope(scope);
  const { data, error } = await getSupabaseClient().from('watched_lots').select(fields)
    .eq('user_id',scope.userId).eq('tenant_id',scope.tenantId).eq('niche_id',scope.nicheId)
    .order('updated_at',{ ascending:false }).order('id',{ ascending:false }).range(offset,offset+WATCHED_LOT_PAGE_SIZE);
  if (error) throw new Error('Your watched lots could not load. Check your connection and account access, then retry.');
  const rows = (data ?? []) as WatchedLot[];
  if (rows.some(row => !isWatchedLotInScope(row,scope) || !validateBase(row.base_valuation))) throw new Error('Your watched lots need checking before opening.');
  return { rows: rows.slice(0,WATCHED_LOT_PAGE_SIZE), hasMore: rows.length > WATCHED_LOT_PAGE_SIZE };
}
export async function saveWatchedLot(scope: WatchedLotScope, session: ManifestSession, stillCurrent: () => boolean = () => true): Promise<WatchedLot> {
  const snapshot = createWatchedLotSnapshot(scope,session);
  const bytes = encodeWatchedLotSnapshot(snapshot);
  const path = watchedSnapshotPath(scope,session.key,Crypto.randomUUID());
  const client = getSupabaseClient();
  const { error: uploadError } = await client.storage.from(WATCHED_LOT_BUCKET).upload(path,bytes.buffer as ArrayBuffer,{ contentType:'application/json',upsert:false });
  if (uploadError) throw new Error('The manifest could not be saved. Check your connection and account access, then retry.');
  if (!stillCurrent()) throw new Error('Your account or niche changed. Return to the original niche to save this lot.');
  // The pointer changes only after a complete immutable upload. Retries update one shortlist row.
  const { data, error } = await client.from('watched_lots').upsert({ user_id:scope.userId,tenant_id:scope.tenantId,niche_id:scope.nicheId,
    manifest_key:snapshot.draft.key,name:snapshot.draft.name,product_count:snapshot.draft.lines.length,
    unit_count:snapshot.draft.lines.reduce((total,line)=>total+line.quantity,0),base_valuation:snapshot.base,
    engine_version:snapshot.engineVersion,snapshot_path:path,updated_at:snapshot.savedAt,auction_url:snapshot.draft.auctionUrl || null },
    { onConflict:'user_id,tenant_id,niche_id,manifest_key' }).select(fields).single();
  if (error || !data) throw new Error('Saving is not confirmed. Retry this same lot to avoid a duplicate.');
  const row = data as WatchedLot;
  if (!isWatchedLotInScope(row,scope)) throw new Error('The saved lot does not match your account.');
  return row;
}
export async function openWatchedLot(scope: WatchedLotScope, id: string): Promise<WatchedLotSnapshot> {
  validateWatchedLotScope(scope);
  if (!uuid.test(id)) throw new Error('Choose a valid watched lot.');
  const client = getSupabaseClient();
  const { data, error } = await client.from('watched_lots').select(fields).eq('id',id)
    .eq('user_id',scope.userId).eq('tenant_id',scope.tenantId).eq('niche_id',scope.nicheId).single();
  if (error || !data || !isWatchedLotInScope(data as WatchedLot,scope)) throw new Error('This lot is no longer available in your shortlist. Refresh and try again.');
  const row = data as WatchedLot;
  const prefix = `${scope.userId}/${scope.tenantId}/${scope.nicheId}/${row.manifest_key}/`;
  if (!row.snapshot_path.startsWith(prefix) || !uuid.test(row.snapshot_path.slice(prefix.length).replace(/\.json$/,'')) || !row.snapshot_path.endsWith('.json')) {
    throw new Error('The saved manifest reference does not match this lot.');
  }
  const { data: signed, error: signError } = await client.storage.from(WATCHED_LOT_BUCKET).createSignedUrl(row.snapshot_path,60);
  if (signError || !signed?.signedUrl) throw new Error('Your saved manifest could not open. Check your account access, then retry.');
  const response = await fetch(signed.signedUrl);
  if (!response.ok) throw new Error('Your saved manifest could not download. Try again.');
  const text = await response.text();
  const snapshot = decodeWatchedLotSnapshot(text,scope,row.manifest_key);
  if (normaliseAuctionUrl(row.auction_url) !== normaliseAuctionUrl(snapshot.draft.auctionUrl)) throw new Error('The saved auction link and list do not match. Refresh your shortlist.');
  // Metadata and file must be the same revision; no hidden recalculation of the saved ceiling.
  if (JSON.stringify(snapshot.base) !== JSON.stringify(row.base_valuation)) {
    const same = Object.keys(snapshot.base).every(key => snapshot.base[key as keyof LotBasePrice] === row.base_valuation[key as keyof LotBasePrice]);
    if (!same) throw new Error('The saved valuation and list do not match. Refresh your shortlist.');
  }
  return snapshot;
}
export async function removeWatchedLot(scope: WatchedLotScope, id: string): Promise<void> {
  validateWatchedLotScope(scope);
  const { data, error } = await getSupabaseClient().from('watched_lots').delete().eq('id',id)
    .eq('user_id',scope.userId).eq('tenant_id',scope.tenantId).eq('niche_id',scope.nicheId).select('id');
  if (error || !data?.length) throw new Error('This lot could not be removed. Refresh your shortlist and try again.');
  // No purchase, inventory or listing mutation. Private historical file revisions are retained.
}
