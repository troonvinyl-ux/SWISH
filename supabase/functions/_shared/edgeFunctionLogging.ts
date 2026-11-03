// SWISH Edge Function execution telemetry.
// Records metadata only. Never persist request/response bodies, headers, credentials or provider payloads.
import { createClient } from 'npm:@supabase/supabase-js@2';

type Handler = (request: Request) => Response | Promise<Response>;

function safeUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

async function writeInvocation(input: {
  functionName: string;
  tenantId: string | null;
  nicheId: string | null;
  statusCode: number;
  durationMs: number;
  errorCode: string | null;
}) {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return;

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const outcome = input.statusCode >= 500
    ? 'failure'
    : input.statusCode >= 400 ? 'client_error' : 'success';

  const { error } = await admin.from('edge_function_logs').insert({
    function_name: input.functionName,
    tenant_id: input.tenantId,
    niche_id: input.nicheId,
    outcome,
    status_code: input.statusCode,
    duration_ms: input.durationMs,
    error_code: input.errorCode,
  });
  if (error) {
    // Deliberately log only a fixed marker: never include provider/database error payloads.
    console.error('[EdgeTelemetry] log persistence failed');
  }
}

export function withEdgeFunctionLogging(functionName: string, handler: Handler): Handler {
  return async (request: Request): Promise<Response> => {
    const started = performance.now();
    let tenantId: string | null = null;
    let nicheId: string | null = null;
    let statusCode = 500;
    let errorCode: string | null = null;

    try {
      // Read only non-sensitive routing identifiers from a clone; original body remains untouched.
      const body = await request.clone().json().catch(() => null) as Record<string, unknown> | null;
      if (body && typeof body === 'object') {
        tenantId = safeUuid(body.tenantId ?? body.tenant_id);
        const rawNiche = body.nicheId ?? body.niche_id ?? body.activeNicheId;
        if (typeof rawNiche === 'string' && rawNiche.length <= 80) nicheId = rawNiche;
      }
    } catch {
      // Telemetry must never prevent the business handler from running.
    }

    try {
      const response = await handler(request);
      statusCode = response.status;
      if (statusCode >= 400) errorCode = `HTTP_${statusCode}`;
      return response;
    } catch (error) {
      errorCode = error instanceof Error
        ? error.name.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 80) || 'UnhandledError'
        : 'UnhandledError';
      throw error;
    } finally {
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      // Persist before returning so the invocation record is not lost when the isolate is suspended.
      // Telemetry failures are swallowed and never replace the business response/error.
      try {
        await writeInvocation({
          functionName,
          tenantId,
          nicheId,
          statusCode,
          durationMs,
          errorCode,
        });
      } catch {
        console.error('[EdgeTelemetry] unexpected telemetry failure');
      }
    }
  };
}
