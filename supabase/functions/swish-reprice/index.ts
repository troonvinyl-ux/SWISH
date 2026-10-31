// SWISH Repricing Edge Function
// Analyses stale/underperforming listings and suggests AI-driven price adjustments.
// Considers: days listed, views, watchers, valuation range, floor price, market context.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { isSpecialistAllowedForReprice, REPRICE_NICHE_SPECIALISTS } from '../_shared/repriceNicheAccess.ts';

interface RepriceRequest {
  listing_id: string;
  tenant_id: string;
  niche_id: string;
  action?: 'suggest' | 'apply';
  new_price?: number;
}

interface RepriceResult {
  listing_id: string;
  item_id: string;
  current_price: number;
  suggested_price: number;
  floor_price: number;
  ceiling_price: number;
  price_change_pct: number;
  strategy: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  urgency: 'immediate' | 'soon' | 'monitor';
  estimated_sale_probability_uplift: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!apiKey || !baseUrl) {
      return new Response(
        JSON.stringify({ error: 'OnSpace AI not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Auth + Tenant Security (HARDENED) ────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authentication required. Please sign in to SWISH.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) {
      return new Response(JSON.stringify({ error: 'Authentication required. Please sign in to SWISH.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired authentication token. Please sign in again.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Parse request ─────────────────────────────────────────────────────────
    const body: RepriceRequest = await req.json();
    const { listing_id, tenant_id, niche_id } = body;
    const allowedSpecialists = typeof niche_id === 'string' ? REPRICE_NICHE_SPECIALISTS[niche_id] : undefined;

    if (!listing_id || !tenant_id || !allowedSpecialists?.length) {
      return new Response(JSON.stringify({ error: 'A valid listing, tenant and registered niche are required.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Verify the authenticated user is a member of the requested tenant
    const { data: membership } = await supabaseAdmin
      .from('tenant_memberships')
      .select('id')
      .eq('tenant_id', tenant_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!membership) {
      console.warn(`[SWISH Security] swish-reprice: User ${user.id} attempted tenant ${tenant_id} — not a member`);
      return new Response(JSON.stringify({ error: 'Access denied: you are not a member of this organisation.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Fetch listing + item (scoped to tenant to prevent cross-tenant reads) ──
    const { data: listing, error: listingError } = await supabaseAdmin
      .from('listings')
      .select('*, items(*)')
      .eq('id', listing_id)
      .eq('tenant_id', tenant_id)
      .single();

    if (listingError || !listing) {
      return new Response(
        JSON.stringify({ error: 'Listing not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const item = Array.isArray(listing.items) ? listing.items[0] : listing.items;
    if (!isSpecialistAllowedForReprice(niche_id, item?.specialist_id)) {
      console.warn('[SWISH Security] swish-reprice denied listing outside requested niche.');
      return new Response(JSON.stringify({ error: 'Listing is not available in the requested niche.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const currentPrice = Number(listing.price ?? 0);
    const floorPrice = Number(listing.floor_price ?? 0) || Number(item?.acquired_cost ?? 0) * 1.1;
    const ceilingPrice = Number(listing.ceiling_price ?? 0) || Number(item?.valuation_high ?? currentPrice * 1.5);

    // Applying a repricing change is authorised and bounded on the server. Never
    // trust the client-side niche preflight as the write boundary.
    if (body.action === 'apply') {
      const newPrice = Number(body.new_price);
      if (!Number.isFinite(newPrice) || newPrice <= 0) {
        return new Response(JSON.stringify({ error: 'A valid positive price is required.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (newPrice < floorPrice || newPrice > ceilingPrice) {
        return new Response(JSON.stringify({ error: 'The requested price is outside the permitted floor and ceiling.' }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const { data: updatedListing, error: updateError } = await supabaseAdmin
        .from('listings')
        .update({ price: Math.round(newPrice * 100) / 100, updated_at: new Date().toISOString() })
        .eq('id', listing_id)
        .eq('tenant_id', tenant_id)
        .select('id')
        .maybeSingle();
      if (updateError || !updatedListing) {
        console.error('[SWISH Reprice] Server-side price update failed.');
        return new Response(JSON.stringify({ error: 'Unable to apply this price change. Please reload and retry.' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, listing_id, price: Math.round(newPrice * 100) / 100 }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (body.action && body.action !== 'suggest') {
      return new Response(JSON.stringify({ error: 'Unsupported repricing action.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Calculate days listed
    const listedDate = listing.published_at ?? listing.created_at;
    const daysListed = listedDate
      ? Math.floor((Date.now() - new Date(listedDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    console.log(`Repricing listing for: ${item?.canonical_title} — listed ${daysListed} days, price: £${currentPrice}`);

    // ── Build AI prompt ───────────────────────────────────────────────────────
    const systemPrompt = `You are SWISH's pricing intelligence engine. You analyse listing performance data and suggest optimal repricing actions to maximise sale probability while protecting profitability. Respond ONLY with valid JSON — no markdown, no explanation.`;

    const userPrompt = `Analyse this listing and suggest a repricing action.

LISTING DATA:
- Item: ${item?.canonical_title ?? 'Unknown'}
- Category: ${item?.specialist_id ?? 'general'}
- Marketplace: ${listing.marketplace_id ?? 'ebay'}
- Current Price: £${currentPrice}
- Floor Price (minimum): £${floorPrice.toFixed(2)}
- Ceiling Price (maximum): £${ceilingPrice.toFixed(2)}
- Days Listed: ${daysListed}
- Views: ${listing.views ?? 0}
- Watchers: ${listing.watchers ?? 0}
- Status: ${listing.status}

ITEM VALUATION:
- Low: £${item?.valuation_low ?? 0}
- Mid: £${item?.valuation_mid ?? 0}
- High: £${item?.valuation_high ?? 0}
- Valuation Confidence: ${item?.valuation_confidence ?? 'unknown'}
- 30-day Sale Probability: ${Math.round(Number(item?.sale_prob_30d ?? 0) * 100)}%
- Condition: ${item?.condition ?? 'Unknown'} ${item?.condition_grade ? `(Grade ${item.condition_grade})` : ''}
- Acquired Cost: £${item?.acquired_cost ?? 0}

REPRICING CONTEXT:
- If views are low and days_listed > 7: listing may have visibility issues (consider price drop to refresh algorithm)
- If views are moderate but watchers are low: price may be just above buyer threshold (try 5-10% reduction)
- If views are high but no sale: price is likely above market — consider 10-15% reduction
- If days_listed > 21 and no sale: stale listing penalty kicks in — consider 15-20% reduction or relist
- If watchers > 3: buyers are interested but price is a barrier — strategic small reduction often converts
- Always respect the floor_price — never suggest below it
- Never suggest above ceiling_price

Respond ONLY with this JSON:
{
  "suggested_price": number,
  "strategy": "one of: reduce_5pct | reduce_10pct | reduce_15pct | reduce_20pct | hold | increase_5pct | relist",
  "rationale": "2-3 sentence explanation of why this price and strategy was chosen",
  "confidence": "high | medium | low",
  "urgency": "immediate | soon | monitor",
  "estimated_sale_probability_uplift": number (0.0 to 0.5 — estimated improvement in 30-day sale probability)
}`;

    // ── Call OnSpace AI ───────────────────────────────────────────────────────
    const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 512,
      }),
    });

    if (!aiResponse.ok) {
      console.error('swish-reprice AI provider request failed.');
      return new Response(
        JSON.stringify({ error: 'Repricing is temporarily unavailable. Please retry.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const rawContent: string = aiData.choices?.[0]?.message?.content ?? '';

    // ── Parse response ────────────────────────────────────────────────────────
    let aiResult: {
      suggested_price: number;
      strategy: string;
      rationale: string;
      confidence: 'high' | 'medium' | 'low';
      urgency: 'immediate' | 'soon' | 'monitor';
      estimated_sale_probability_uplift: number;
    };

    try {
      const cleaned = rawContent
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      aiResult = JSON.parse(cleaned);
    } catch {
      console.error('swish-reprice received an invalid AI response.');
      // Fallback: suggest 10% reduction
      const fallbackPrice = Math.max(floorPrice, currentPrice * 0.9);
      aiResult = {
        suggested_price: Math.round(fallbackPrice * 100) / 100,
        strategy: 'reduce_10pct',
        rationale: 'Automatic 10% reduction applied based on listing age and performance data.',
        confidence: 'low',
        urgency: daysListed > 14 ? 'soon' : 'monitor',
        estimated_sale_probability_uplift: 0.1,
      };
    }

    // ── Clamp price within floor/ceiling ─────────────────────────────────────
    const suggestedPrice = Math.max(
      floorPrice,
      Math.min(ceilingPrice, aiResult.suggested_price ?? currentPrice)
    );
    const priceChangePct = currentPrice > 0
      ? (suggestedPrice - currentPrice) / currentPrice
      : 0;

    const result: RepriceResult = {
      listing_id,
      item_id: listing.item_id,
      current_price: currentPrice,
      suggested_price: Math.round(suggestedPrice * 100) / 100,
      floor_price: Math.round(floorPrice * 100) / 100,
      ceiling_price: Math.round(ceilingPrice * 100) / 100,
      price_change_pct: Math.round(priceChangePct * 1000) / 1000,
      strategy: aiResult.strategy,
      rationale: aiResult.rationale,
      confidence: aiResult.confidence,
      urgency: aiResult.urgency,
      estimated_sale_probability_uplift: aiResult.estimated_sale_probability_uplift ?? 0,
    };

    console.log(`Reprice result: £${currentPrice} → £${result.suggested_price} (${result.strategy})`);

    return new Response(
      JSON.stringify({ result }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('swish-reprice failed.');
    return new Response(
      JSON.stringify({ error: 'Unable to reprice this listing. Please retry.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
