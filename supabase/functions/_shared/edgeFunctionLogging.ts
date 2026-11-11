// Metadata-only telemetry; shared dependency restored from the current GitHub contract.
// No request bodies, headers, tokens, callback URLs or provider payloads are persisted.
import { createClient } from 'npm:@supabase/supabase-js@2';
type Handler = (request: Request) => Response | Promise<Response>;
const measuredHandlers = new WeakSet<Handler>();
async function safeTenantId(request: Request): Promise<string | null> {
  try {
    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (!Number.isFinite(contentLength) || contentLength <= 0 || !(contentLength <= 64 * 1024)) return null;
    if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return null;
    const body = await request.clone().json();
    const candidate = body && typeof body === 'object' ? (body.tenantId ?? body.tenant_id) : null;
    return typeof candidate === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(candidate) ? candidate : null;
  } catch { return null; }
}
export function isEdgeFunctionLogged(handler:Handler):boolean { return measuredHandlers.has(handler); }
export function withEdgeFunctionLogging(functionName: string, handler: Handler): Handler {
  const logged:Handler = async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return handler(request);
    const started = performance.now();
    const tenantId = await safeTenantId(request);
    let statusCode = 500;
    try {
      const response = await handler(request);
      statusCode = response.status;
      return response;
    } finally {
      const url = Deno.env.get('SUPABASE_URL');
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (url && key) {
        const durationMs = Math.max(0, Math.round(performance.now() - started));
        const persist = async () => { try {
          const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
          const input = { tenantId, durationMs };
          const { error } = await admin.from('edge_function_logs').insert({
            tenant_id: input.tenantId,
            function_name: functionName, status_code: statusCode,
            outcome: statusCode >= 500 ? 'failure' : statusCode >= 400 ? 'client_error' : 'success',
            duration_ms: input.durationMs,
            error_code: statusCode >= 400 ? `HTTP_${statusCode}` : null,
          }).abortSignal(AbortSignal.timeout(2000));
          if (error) console.error('[EdgeTelemetry] persistence unavailable');
        } catch { console.error('[EdgeTelemetry] persistence unavailable'); } };
        // OnSpace/Deno background lifetime, when available; do not delay the commercial response for telemetry.
        const runtime=(globalThis as unknown as {EdgeRuntime?:{waitUntil:(task:Promise<unknown>)=>void}}).EdgeRuntime;
        if(runtime?.waitUntil)runtime.waitUntil(persist());else await persist();
      }
    }
  };
  measuredHandlers.add(logged);
  return logged;
}
