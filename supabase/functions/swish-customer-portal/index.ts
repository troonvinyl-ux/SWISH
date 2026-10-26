// SWISH — Stripe Customer Portal Edge Function
// Creates a Stripe Billing Portal session so users can manage/cancel their subscription.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` — ${JSON.stringify(details)}` : "";
  console.log(`[customer-portal] ${step}${detailsStr}`);
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

    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401,
      });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Authentication required." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401,
      });
    }
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !userData.user?.email) {
      throw new Error("User not authenticated or email unavailable");
    }
    const user = userData.user;
    logStep("User authenticated", { userId: user.id });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({ email: user.email, limit: 100 });

    // Prefer an explicit account link; never select a Stripe customer by email alone.
    let customer = customers.data.find(candidate => candidate.metadata?.user_id === user.id);

    // Safely preserve billing management for legacy subscribers. Auto-link only
    // a confirmed account with exactly one unlinked customer holding an active
    // SWISH Premium subscription that is not explicitly assigned to another user.
    if (!customer && user.email_confirmed_at) {
      const eligibleLegacyCustomers: typeof customers.data = [];
      for (const candidate of customers.data.filter(item => !item.metadata?.user_id)) {
        const subscriptions = await stripe.subscriptions.list({ customer: candidate.id, status: "all", limit: 100 });
        const hasEligibleSubscription = subscriptions.data.some(sub =>
          (sub.status === "active" || sub.status === "trialing") &&
          (!sub.metadata?.user_id || sub.metadata.user_id === user.id) &&
          (sub.items.data[0]?.price?.product as string | undefined) === "prod_VQ0JxUCL29SZPQ"
        );
        if (hasEligibleSubscription) eligibleLegacyCustomers.push(candidate);
      }
      if (eligibleLegacyCustomers.length === 1) {
        customer = await stripe.customers.update(eligibleLegacyCustomers[0].id, {
          metadata: { ...eligibleLegacyCustomers[0].metadata, user_id: user.id },
        });
        logStep("Linked one unambiguous legacy billing customer", { customerId: customer.id });
      }
    }

    if (!customer) {
      return new Response(JSON.stringify({ error: "No billing account is safely linked to this user. Please contact support." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404,
      });
    }

    const customerId = customer.id;
    logStep("Linked Stripe customer found", { customerId });

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: "onspaceapp://subscription",
    });

    logStep("Portal session created", { sessionId: portalSession.id });

    return new Response(JSON.stringify({ url: portalSession.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown error";
    logStep("Billing portal creation failed", { message: msg });
    return new Response(
      JSON.stringify({ error: "Unable to open billing management. Please retry or contact support." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
