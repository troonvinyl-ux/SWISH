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
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 405,
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
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401,
      });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return new Response(JSON.stringify({ error: "Authentication required." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401,
    });
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !userData.user?.email) {
      throw new Error("User not authenticated or email unavailable");
    }
    const user = userData.user;
    console.log(`[create-checkout] User: ${user.id} — ${user.email}`);

    let body: Record<string, unknown> = {};
    const rawBody = await req.text();
    if (rawBody.trim()) {
      try {
        const parsed: unknown = JSON.parse(rawBody);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return new Response(JSON.stringify({ error: "Request body must be a JSON object." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
          });
        }
        body = parsed as Record<string, unknown>;
      } catch {
        return new Response(JSON.stringify({ error: "Invalid checkout request." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
        });
      }
    }
    let nicheId = typeof body.nicheId === "string" ? body.nicheId.trim().toLowerCase() : "coins";
    // Checkout metadata must use a recognised production niche so the same
    // entitlement can be read consistently by swish-check-subscription.
    if (nicheId === "surplus_trader") nicheId = "surplus_flip";
    const allowedNiches = new Set(["coins", "motocross", "bicycles", "clothing", "surplus_flip", "trading_cards", "antiques", "fossils", "beauty", "tech"]);
    if (!allowedNiches.has(nicheId)) {
      return new Response(JSON.stringify({ error: "Unknown SWISH subscription niche." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const expectedSchemeByNiche: Record<string, string> = {
      coins: "coinflipper", motocross: "flippermx", bicycles: "bikeflipper",
      clothing: "threadsflip", surplus_flip: "surplusflip", trading_cards: "cardflipper",
      antiques: "antiqueflipper", fossils: "fossilflipper", beauty: "beautyflipper", tech: "techflipper",
    };
    const expectedScheme = expectedSchemeByNiche[nicheId];
    const requestedScheme = typeof body.appScheme === "string" ? body.appScheme : undefined;
    if (requestedScheme && requestedScheme !== expectedScheme) {
      return new Response(JSON.stringify({ error: "Invalid app callback scheme for this subscription." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }
    const callbackScheme = expectedScheme;

    // Only reuse a Stripe customer explicitly bound to this authenticated user.
    const customers = await stripe.customers.list({ email: user.email, limit: 100 });
    let customerId = customers.data.find((candidate) => candidate.metadata?.user_id === user.id)?.id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email, metadata: { user_id: user.id, swish_customer: "true" },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
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
    console.error("[create-checkout] Checkout request failed.");
    return new Response(JSON.stringify({ error: "Unable to start checkout. Please retry or contact support." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
