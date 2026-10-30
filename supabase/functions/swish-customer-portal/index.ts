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
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required." }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return new Response(JSON.stringify({ error: "Authentication required." }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 });
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !userData.user?.email) {
      throw new Error("User not authenticated or email unavailable");
    }
    const user = userData.user;
    logStep("User authenticated", { userId: user.id, email: user.email });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({ email: user.email, limit: 100 });
    let customer = customers.data.find((candidate) => candidate.metadata?.user_id === user.id);

    // Recover a legacy customer only when a verified account has one unambiguous
    // customer whose active SWISH subscription already identifies this user.
    if (!customer && user.email_confirmed_at) {
      const eligibleLegacyCustomers = [];
      for (const candidate of customers.data.filter((entry) => !entry.metadata?.user_id)) {
        const legacySubs = await stripe.subscriptions.list({ customer: candidate.id, status: "all", limit: 100 });
        const ownsSwishSubscription = legacySubs.data.some((sub) => sub.metadata?.user_id === user.id &&
          (sub.status === "active" || sub.status === "trialing") &&
          sub.items.data.some((item) => item.price.product === "prod_VQ0JxUCL29SZPQ"));
        if (ownsSwishSubscription) eligibleLegacyCustomers.push(candidate);
      }
      if (eligibleLegacyCustomers.length === 1) {
        customer = await stripe.customers.update(eligibleLegacyCustomers[0].id, {
          metadata: { ...eligibleLegacyCustomers[0].metadata, user_id: user.id, swish_customer: "true" },
        });
      }
    }
    if (!customer) return new Response(JSON.stringify({ error: "No subscription customer is linked to this account." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404,
    });
    const customerId = customer.id;
    logStep("Stripe customer verified", { customerId });
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
    logStep("Customer portal request failed.");
    return new Response(
      JSON.stringify({ error: "Unable to open billing management. Please retry or contact support." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
