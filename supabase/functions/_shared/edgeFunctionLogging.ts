// Metadata-only telemetry; shared dependency restored from the current GitHub contract.
// No request bodies, headers, tokens, callback URLs or provider payloads are persisted.
import { createClient } from 'npm:@supabase/supabase-js@2';
type Handler = (request: Request) => Response | Promise<Response>;
const measuredHandlers = new WeakSet<Handler>();
export function isEdgeFunctionLogged(handler:Handler):boolean { return measuredHandlers.has(handler); }
export function withEdgeFunctionLogging(functionName: string, handler: Handler): Handler {
  const logged:Handler = async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return handler(request);
    const started = performance.now();
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
          const { error } = await admin.from('edge_function_logs').insert({
            function_name: functionName, status_code: statusCode,
            outcome: statusCode >= 500 ? 'failure' : statusCode >= 400 ? 'client_error' : 'success',
            duration_ms: durationMs,
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
