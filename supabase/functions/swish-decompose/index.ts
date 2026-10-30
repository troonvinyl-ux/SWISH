// SWISH Collection Decomposition Engine — Edge Function
// Core SWISH capability: analyse a bulk acquisition, detect all separable assets,
// identify prize items, calculate decomposition uplift, choose optimal exit strategies.
// BUY BIG → UNDERSTAND EVERYTHING → BREAK IT DOWN → SELL SMART
//
// Security: JWT + tenant membership required.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const DECOMPOSITION_SYSTEM_PROMPT = `You are SWISH's Collection Intelligence Engine — an expert in bulk acquisition decomposition.

Your job is to analyse a collection/acquisition and determine:
1. What is ACTUALLY inside it (decompose the bundle into separable units)
2. What each component is worth individually vs as a bundle
3. Where value is concentrated ("prize items")
4. Whether mis-bundling has created an opportunity (bundle worth less than decomposed)
5. The optimal exit strategy that MAXIMISES NET PROFIT after labour
6. Specialist routing for each category
7. Labour economics: profit per hour for individual vs bulk strategies

KEY ECONOMIC PRINCIPLES:
- Do NOT maximise gross value. Maximise profit per labour hour.
- A bulk strategy at £250 profit in 3 hours (£83/hr) may be better than individual listings at £350 profit in 20 hours (£17.50/hr)
- Prize items = single items capable of recovering the acquisition cost alone
- Mis-bundling = seller has combined items that buyers value more separately
- Collection arbitrage = buy bundled → sell optimally decomposed

Return ONLY valid JSON (no markdown fences) in this exact structure:
{
  "suggestedStrategy": "One paragraph strategy recommendation explaining the optimal approach and why",
  "recommendedApproach": "individual|bulk|mixed|auction|hold",
  "wholeBundleValue": 0,
  "decomposedValue": 0,
  "decompositionUplift": 0,
  "upliftPct": 0.0,
  "expectedGrossRevenue": 0,
  "expectedNetRevenue": 0,
  "expectedProfit": 0,
  "expectedROI": 0.0,
  "individualLabourHours": 0,
  "bulkLabourHours": 0,
  "recommendedLabourHours": 0,
  "individualProfitPerHour": 0,
  "bulkProfitPerHour": 0,
  "profitPerLabourHour": 0,
  "prizeItemCount": 0,
  "prizeItemsValue": 0,
  "prizeCoveragePct": 0.0,
  "misBundlingDetected": false,
  "collectionPatterns": [],
  "itemBreakdown": {
    "individual_listings": 0,
    "small_bundles": 0,
    "bulk_lots": 0,
    "prize_items": 0,
    "hold_items": 0,
    "scrap_candidates": 0,
    "review_required": 0
  },
  "specialistRoutes": {
    "specialist_id": {
      "count": 0,
      "estimatedValue": 0,
      "strategy": "individual|bundle|lot|scrap",
      "notes": ""
    }
  },
  "exitStrategies": [
    {
      "strategy": "Individual eBay listings",
      "itemCount": 0,
      "expectedRevenue": 0,
      "expectedLabourHours": 0,
      "profitPerHour": 0,
      "rationale": ""
    }
  ],
  "warnings": [],
  "confidence": "high|medium|low"
}

All monetary values in GBP (numbers only). ROI as decimal (0.3 = 30%). Labour hours as decimals.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');

    if (!apiKey || !baseUrl) {
      return new Response(
        JSON.stringify({ error: 'OnSpace AI not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Auth + Tenant Security ────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authentication required. Please sign in to SWISH.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) {
      return new Response(JSON.stringify({ error: 'Authentication required. Please sign in to SWISH.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const userClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired authentication token. Please sign in again.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { tenant_id } = body;
    if (tenant_id) {
      const { data: membership } = await supabaseAdmin.from('tenant_memberships').select('id').eq('tenant_id', tenant_id).eq('user_id', user.id).maybeSingle();
      if (!membership) {
        console.warn(`[SWISH Security] swish-decompose: User ${user.id} attempted tenant ${tenant_id} — not a member`);
        return new Response(JSON.stringify({ error: 'Access denied: you are not a member of this organisation.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const {
      acquisition_title,
      acquisition_description,
      acquisition_source,
      purchase_price,
      item_count,
      existing_items, // already-identified items [{title, specialist, valuationMid, condition}]
      description_text, // free text from seller listing if available
      categories, // [string] known categories
      tenant_context, // {currency, riskTolerance, minROI}
    } = body;

    if (!acquisition_title) {
      return new Response(
        JSON.stringify({ error: 'acquisition_title is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const costBasis = Number(purchase_price ?? 0);
    const currency = tenant_context?.currency ?? 'GBP';

    // Build analysis prompt
    const userPrompt = `
ACQUISITION TO DECOMPOSE:
Title: ${acquisition_title}
Description: ${acquisition_description || 'None provided'}
Source: ${acquisition_source || 'Unknown'}
Purchase Price: ${currency}${costBasis}
Estimated Item Count: ${item_count ?? 'Unknown'}
Known Categories: ${categories?.join(', ') || 'Unknown — auto-detect'}

${description_text ? `Seller Listing Text:\n${description_text}\n` : ''}

${existing_items?.length > 0 ? `Already Identified Items (${existing_items.length}):
${existing_items.slice(0, 20).map((i: any) => `- ${i.title} (${i.specialist ?? 'unknown'}) | Est. £${i.valuationMid ?? 0} | ${i.condition ?? 'unknown condition'}`).join('\n')}` : 'No items identified yet — analyse from title/description.'}

Business Rules:
- Currency: ${currency}
- Min Target ROI: ${((tenant_context?.minROI ?? 0.3) * 100).toFixed(0)}%
- Risk Tolerance: ${tenant_context?.riskTolerance ?? 'medium'}

Perform complete decomposition analysis. Identify prize items (items that alone could recover £${costBasis} acquisition cost).
Detect mis-bundling opportunities. Calculate profit per labour hour for individual vs bulk strategies.
Recommend the strategy that MAXIMISES net profit per labour hour, not just gross revenue.
`;

    const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: DECOMPOSITION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('OnSpace AI decompose error:', errText);
      return new Response(
        JSON.stringify({ error: `OnSpace AI: ${errText}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content ?? '';
    console.log('Decomposition raw response:', rawContent.slice(0, 800));

    let decomposition: any = null;
    try {
      const cleaned = rawContent
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();
      decomposition = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('swish-decompose returned invalid JSON.');
      return new Response(
        JSON.stringify({ error: 'The decomposition service returned an invalid response.' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate and fill defaults
    const result = {
      suggestedStrategy: decomposition.suggestedStrategy ?? 'Analysis complete. Review breakdown.',
      recommendedApproach: decomposition.recommendedApproach ?? 'mixed',
      wholeBundleValue: Number(decomposition.wholeBundleValue ?? 0),
      decomposedValue: Number(decomposition.decomposedValue ?? 0),
      decompositionUplift: Number(decomposition.decompositionUplift ?? 0),
      upliftPct: Number(decomposition.upliftPct ?? 0),
      expectedGrossRevenue: Number(decomposition.expectedGrossRevenue ?? 0),
      expectedNetRevenue: Number(decomposition.expectedNetRevenue ?? 0),
      expectedProfit: Number(decomposition.expectedProfit ?? 0),
      expectedROI: Number(decomposition.expectedROI ?? 0),
      individualLabourHours: Number(decomposition.individualLabourHours ?? 0),
      bulkLabourHours: Number(decomposition.bulkLabourHours ?? 0),
      recommendedLabourHours: Number(decomposition.recommendedLabourHours ?? 0),
      individualProfitPerHour: Number(decomposition.individualProfitPerHour ?? 0),
      bulkProfitPerHour: Number(decomposition.bulkProfitPerHour ?? 0),
      profitPerLabourHour: Number(decomposition.profitPerLabourHour ?? 0),
      prizeItemCount: Number(decomposition.prizeItemCount ?? 0),
      prizeItemsValue: Number(decomposition.prizeItemsValue ?? 0),
      prizeCoveragePct: Number(decomposition.prizeCoveragePct ?? 0),
      misBundlingDetected: Boolean(decomposition.misBundlingDetected ?? false),
      collectionPatterns: decomposition.collectionPatterns ?? [],
      itemBreakdown: decomposition.itemBreakdown ?? {},
      specialistRoutes: decomposition.specialistRoutes ?? {},
      exitStrategies: decomposition.exitStrategies ?? [],
      warnings: decomposition.warnings ?? [],
      confidence: decomposition.confidence ?? 'medium',
    };

    return new Response(
      JSON.stringify({ decomposition: result }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('swish-decompose failed.');
    return new Response(
      JSON.stringify({ error: 'The decomposition service is temporarily unavailable.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
