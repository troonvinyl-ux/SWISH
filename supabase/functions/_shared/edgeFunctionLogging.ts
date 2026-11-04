// Metadata-only telemetry; shared dependency restored from the current GitHub contract.
// No request bodies, headers, tokens, callback URLs or provider payloads are persisted.
import { createClient } from 'npm:@supabase/supabase-js@2';
type Handler = (request: Request) => Response | Promise<Response>;
export function withEdgeFunctionLogging(functionName: string, handler: Handler): Handler {
  return async (request: Request): Promise<Response> => {
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
        try {
          const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
          const { error } = await admin.from('edge_function_logs').insert({
            function_name: functionName, status_code: statusCode,
            outcome: statusCode >= 500 ? 'failure' : statusCode >= 400 ? 'client_error' : 'success',
            duration_ms: Math.max(0, Math.round(performance.now() - started)),
            error_code: statusCode >= 400 ? `HTTP_${statusCode}` : null,
          });
          if (error) console.error('[EdgeTelemetry] persistence unavailable');
        } catch { console.error('[EdgeTelemetry] persistence unavailable'); }
      }
    }
  };
}
