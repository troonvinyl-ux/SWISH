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

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Authorization header not provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !userData.user?.email) {
      throw new Error("User not authenticated or email unavailable");
    }
    const user = userData.user;
    console.log(`[create-checkout] User: ${user.id} — ${user.email}`);

    const allowedNiches = new Set(["coins", "motocross", "bicycles", "clothing"]);
    let nicheId = "coins";
    try {
      const body = await req.json();
      if (body?.nicheId !== undefined) {
        if (typeof body.nicheId !== "string") {
          return new Response(JSON.stringify({ error: "Invalid nicheId." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          });
        }
        nicheId = body.nicheId.trim().toLowerCase();
        if (!allowedNiches.has(nicheId)) {
          return new Response(JSON.stringify({ error: "Unsupported nicheId. Choose coins, motocross, bicycles, or clothing." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          });
        }
      }
    } catch (error) {
      // Empty body retains the legacy Coins checkout default.
      if (error instanceof SyntaxError) {
        nicheId = "coins";
      } else {
        throw error;
      }
    }

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
      success_url: "onspaceapp://subscription/success",
      cancel_url: "onspaceapp://subscription/cancel",
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
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[create-checkout] Error: ${msg}`);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
