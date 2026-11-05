# Tunes Flip delivery security notes

Discogs credential values are read only inside `supabase/functions/swish-discogs/index.ts` with `Deno.env.get`. Client services call the existing authenticated Supabase Edge gateway. UI setup instructions reveal names/presence, never values. No client/public environment variables, secret-input forms, credential DB columns or logging were added.

Required configured names: DISCOGS_CONSUMER_KEY, DISCOGS_CONSUMER_SECRET, DISCOGS_USER_AGENT. No user-token OAuth is implemented for public catalogue lookup; no invented callback exists. Private collection/ wantlist access is not part of the SWISH My Collection view.

The actual billing CHECK still excludes Tunes Flip and Collectibles. Tunes Flip checkout now fails before Stripe calls, preventing a charge for unavailable entitlement registration. Catalogue/Discogs-derived marketplace usage remains server-blocked pending written commercial-use permission; restricted artwork/prices are always excluded.

A catalogue-only item keeps its saved ID and the capture route directs the user to that existing item for photographs and condition, avoiding accidental duplicate inventory. New physical items require an explicit new search/capture.

Executed SQL results: music maps to tunes_flip; original coins mapping retained; catch-all remains null; command snapshot includes music; anon command execute false; authenticated execute true; existing music inventory count zero. Identity-free SQL denied music platform reporting. These results do not certify HTTP 403s, caller RLS with real owner/subscriber JWTs, Discogs key validity, inventory persistence or seller actions.

New CI and regression source is prepared, not executed in this editor. The endpoint owner setup controls perform a genuine read-only connection test after deployment. Current-main CI, approved JWT fixtures, provider/sandbox, native/web and release acceptance are outstanding. No production item/seller/subscriber records were changed by tests, no release built and no PR/merge fabricated.

See `docs/TUNES_FLIP_IMPLEMENTATION.md` and `docs/TUNES_FLIP_EVIDENCE.json` for the full implementation report and limitations.
