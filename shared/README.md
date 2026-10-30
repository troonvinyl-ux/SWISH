# SWISH shared engine boundary

This directory is the target home for capabilities that are common to every SWISH product: authentication/session handling, tenant and subscription resolution, inventory persistence, eBay OAuth/listings/drafts/orders/sync, shared AI orchestration, learning/prediction services, and reusable UI primitives.

## Migration rule

Move code here only when it is niche-agnostic and used by at least two products. Keep current implementations and imports working during migration; do not duplicate the database, Supabase project, auth system, or eBay integration. Niche-specific prompts, attributes, category mapping, scanner flows, valuation rules, and theme tokens belong under `niches/<id>/`.

This directory is an architectural boundary marker, not a claim that the existing app has already been physically migrated.
