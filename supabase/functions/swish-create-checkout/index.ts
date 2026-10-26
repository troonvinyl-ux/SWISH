// SWISH — Stripe Checkout Edge Function
// Creates a Stripe Checkout session for the £9.99/month SWISH Niche Premium subscription.
// POST body: { nicheId?: string } — optional nicheId stored in session metadata.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PRICE_ID = "price_1UPAIlI5Y99su2PXUrM192qL";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 405,
    });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Authentication required." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !userData.user?.email) {
      return new Response(JSON.stringify({ error: "User authentication could not be verified." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const user = userData.user;

    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return new Response(JSON.stringify({ error: "Request body must be a JSON object." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
      body = parsed as Record<string, unknown>;
    } catch (error) {
      // Empty body remains supported for older clients; malformed non-empty JSON is rejected.
      const raw = await req.clone().text().catch(() => "");
      if (raw.trim()) {
        return new Response(JSON.stringify({ error: "Invalid checkout request." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
    }
    let nicheId = typeof body.nicheId === "string" ? body.nicheId.trim().toLowerCase() : "coins";
    // Checkout metadata must use a recognised production niche so the same
    // entitlement can be read consistently by swish-check-subscription.
    if (nicheId === "surplus_trader") nicheId = "surplus_flip";
    const allowedNiches = new Set(["coins", "motocross", "bicycles", "clothing", "surplus_flip"]);
    if (!allowedNiches.has(nicheId)) {
      return new Response(JSON.stringify({ error: "Unknown SWISH subscription niche." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Only known app schemes are accepted, and each branded scheme must match
    // its canonical niche. Never reflect an arbitrary client-supplied redirect.
    const expectedSchemeByNiche: Record<string, string> = {
      coins: "coinflipper",
      motocross: "flippermx",
      bicycles: "bikeflipper",
      clothing: "threadsflip",
      surplus_flip: "surplusflip",
    };
    const appScheme = typeof body.appScheme === "string" ? body.appScheme.trim() : "";
    if (appScheme && appScheme !== expectedSchemeByNiche[nicheId]) {
      return new Response(JSON.stringify({ error: "The app scheme does not match the selected SWISH product." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    const callbackScheme = appScheme || "onspaceapp";

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Reuse existing customer if they have one
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      console.log(`[create-checkout] Existing Stripe customer: ${customerId}`);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      mode: "subscription",
      success_url: `${callbackScheme}://subscription/success`,
      cancel_url: `${callbackScheme}://subscription/cancel`,
      metadata: { user_id: user.id, niche_id: nicheId },
      subscription_data: {
        metadata: { user_id: user.id, niche_id: nicheId },
      },
    });

    console.log(`[create-checkout] Session created: ${session.id}`);
    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    // Keep provider/internal error details in server logs only; never echo them to clients.
    console.error("[create-checkout] Checkout session creation failed:", error instanceof Error ? error.message : "unknown error");
    return new Response(JSON.stringify({ error: "Unable to start checkout. Please retry or contact support." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
