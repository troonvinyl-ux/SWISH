// Portable contracts over the existing registry; no React, client, secrets or second registry.
import registry from '../niche-modules.json';

export type RegisteredNicheId = keyof typeof registry.products;
export type CoreServiceId = typeof registry.coreServices[number];
export interface NicheModuleContract {
  id: string; name: string; slug: string; scheme: string;
  androidPackage: string; iosBundleIdentifier: string;
  entry: string; home: string | null; scannerRoute: string;
  aliases: string[]; specialists: string[]; legacySpecialists: string[];
  defaultSpecialist: string; dedicatedRoutes: string[];
}
export const MODULE_CONTRACT_VERSION = registry.contractVersion;
export const REGISTERED_NICHE_IDS = Object.keys(registry.products) as RegisteredNicheId[];
export const REGISTERED_MODULES: Record<RegisteredNicheId, NicheModuleContract> = registry.products;

export interface OperationScope { tenantId: string; nicheId: RegisteredNicheId; itemId?: string }
export interface ServiceFailure { code: string; message: string; retryable: boolean; outcome: 'failed' | 'unknown' }
export type ServiceResult<T> = { data: T; error: null } | { data: null; error: ServiceFailure };
export interface EvidenceClaim<T> {
  value: T; source: 'detected' | 'inferred' | 'researched' | 'user_confirmed' | 'verified' | 'unknown';
  confidence: number | null; evidence: string[]; recordedAt: string;
}

/** Validate scoped extension inputs; this is NOT authorization. The server/RLS grants access. */
export function isOperationScope(value: unknown): value is OperationScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const scope = value as Record<string, unknown>;
  return typeof scope.tenantId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope.tenantId)
    && typeof scope.nicheId === 'string' && Object.prototype.hasOwnProperty.call(REGISTERED_MODULES, scope.nicheId)
    && (scope.itemId === undefined || (typeof scope.itemId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope.itemId)));
}

/** The generic catch-all is intentionally not assigned to a production product. */
export function registeredSpecialistOwner(specialistId: string): RegisteredNicheId | null {
  return REGISTERED_NICHE_IDS.find(id => {
    const product = REGISTERED_MODULES[id];
    return product.specialists.includes(specialistId) || product.legacySpecialists.includes(specialistId);
  }) ?? null;
}
