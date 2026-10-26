// SWISH AI Coin Image Enhancement
//
// Generates a separate, AI-rendered visual reference from a coin photo.
// The original image is never modified or returned as the listing image.
// This is intentionally a visual aid only: generated pixels can alter small
// details, so original photographs remain the source of truth for listings.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function extractImageUrl(payload: any): string | null {
  const message = payload?.choices?.[0]?.message;
  const candidates = [
    ...(Array.isArray(message?.images) ? message.images : []),
    ...(Array.isArray(message?.content) ? message.content : []),
    ...(Array.isArray(payload?.images) ? payload.images : []),
  ];
  for (const item of candidates) {
    const url = item?.image_url?.url ?? item?.image_url ?? item?.url ??
      item?.data_url ?? item?.data;
    if (typeof url === 'string' && (url.startsWith('data:image/') || /^https:\/\//i.test(url))) return url;
    if (Array.isArray(item?.image_url) && typeof item.image_url[0]?.url === 'string') return item.image_url[0].url;
  }
  if (typeof message?.content === 'string') {
    const match = message.content.match(/data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+/i);
    if (match) return match[0];
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST required' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Authentication required' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return jsonResponse({ error: 'Authentication required' }, 401);

    const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
    if (!apiKey || !baseUrl) return jsonResponse({ error: 'OnSpace AI is not configured on the server.' }, 503);

    const body = await req.json();
    const imageDataUrl = body?.imageDataUrl;
    if (typeof imageDataUrl !== 'string' || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(imageDataUrl)) {
      return jsonResponse({ error: 'A base64 image data URL is required.' }, 400);
    }
    // Guard request size to avoid accidental multi-megabyte uploads.
    if (imageDataUrl.length > 8_000_000) return jsonResponse({ error: 'Image is too large. Retake or resize it and try again.' }, 413);

    const prompt = [
      'Create a photorealistic, high-clarity conservation-style visual reference of the exact coin shown in the input image.',
      'Preserve the exact coin design, visible lettering, orientation, flan shape, wear, corrosion, patina, scratches and edge irregularities.',
      'Automatically detect the coin’s complete outer boundary and tightly crop around it, removing excess background. Centre the coin and make it fill about 85–90% of the frame while keeping the entire rim and irregular edges visible.',
      'Replace the surrounding background with a clean neutral white or very light grey background. Do not cut off any part of the coin and do not leave large empty margins.',
      'Improve legibility through careful macro lighting, local contrast and focus; preserve the coin’s original orientation and proportions.',
      'Do not invent, reconstruct, complete, replace, translate or embellish any inscription or design. Do not make the coin look newer, cleaner, more valuable or made of a different metal.',
      'Do not add labels, measurements, hands, holders, shadows from other objects, or extra coins.',
      'If a feature is indistinct in the input, leave it indistinct rather than hallucinating detail.',
      'This is an AI-generated viewing aid, not documentary evidence. Return the edited image only.',
    ].join(' ');

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image',
        modalities: ['image', 'text'],
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        }],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      // Provider bodies may contain user data or internal diagnostics; never log them.
      console.error('[swish-coin-image-enhance] model request failed', response.status);
      return jsonResponse({ error: 'AI image enhancement is temporarily unavailable. The original photo is safe.', code: 'MODEL_UNAVAILABLE' }, 502);
    }

    const payload = await response.json();
    const enhancedImage = extractImageUrl(payload);
    if (!enhancedImage) {
      console.warn('[swish-coin-image-enhance] model response contained no image output');
      return jsonResponse({ error: 'The configured AI model did not return an edited image. The original photo is unchanged.', code: 'NO_IMAGE_OUTPUT' }, 502);
    }

    return jsonResponse({
      enhancedImage,
      generatedBy: 'Gemini image model',
      warning: 'AI-rendered reference only. Always use the original photo for eBay listings and final attribution.',
    });
  } catch (error) {
    console.error('[swish-coin-image-enhance] request failed', error instanceof Error ? error.message : 'unknown error');
    return jsonResponse({ error: 'Image enhancement failed safely. The original photo is unchanged.' }, 500);
  }
});
