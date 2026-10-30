// SWISH — Stripe Subscription Check Edge Function
// Checks whether the authenticated user has an active SWISH Niche Premium subscription.
// Called on login, app launch, and periodically to keep subscription state fresh.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` — ${JSON.stringify(details)}` : "";
  console.log(`[check-subscription] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Authorization header not provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !userData.user?.email) {
      throw new Error("User not authenticated or email unavailable");
    }
    const user = userData.user;
    logStep("User authenticated", { userId: user.id, email: user.email });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });

    if (customers.data.length === 0) {
      logStep("No Stripe customer found — user not subscribed");
      return new Response(
        JSON.stringify({ subscribed: false, product_id: null, price_id: null, subscription_end: null, niche_entitlements: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const customerId = customers.data[0].id;
    logStep("Stripe customer found", { customerId });

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 100,
    });

    // A single active subscription unlocks only the niche stored in its verified
    // Stripe metadata. Legacy subscriptions without niche metadata remain Coins.
    const nicheEntitlements = new Set<string>();
    let productId: string | null = null;
    let subscriptionEnd: string | null = null;
    let priceId: string | null = null;
    const allowedNiches = new Set(["coins", "motocross", "bicycles", "clothing"]);

    for (const sub of subscriptions.data) {
      const subProductId = sub.items.data[0]?.price?.product as string | undefined;
      if (subProductId !== "prod_VQ0JxUCL29SZPQ") continue;

      const nicheId = String(sub.metadata?.niche_id ?? "coins").toLowerCase();
      if (!allowedNiches.has(nicheId)) continue;
      nicheEntitlements.add(nicheId);

      if (!productId) {
        productId = subProductId;
        priceId = sub.items.data[0]?.price?.id ?? null;
        subscriptionEnd = new Date(sub.current_period_end * 1000).toISOString();
      }
      logStep("Niche subscription found", { subscriptionId: sub.id, nicheId });
    }

    const entitlements = [...nicheEntitlements];
    return new Response(
      JSON.stringify({
        subscribed: entitlements.length > 0,
        product_id: productId,
        price_id: priceId,
        subscription_end: subscriptionEnd,
        niche_entitlements: entitlements,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("Error", { message: msg });
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
