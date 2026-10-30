# SWISH niche modules

Each product module owns only its product-specific behaviour and presentation. Shared eBay, account, database, inventory, listing, learning, and prediction capabilities remain in `/shared`.

A module must export a stable manifest with:
- canonical niche ID and canonical specialist IDs
- product-specific route/entry point
- identification prompt/configuration
- listing attributes and category-specific item specifics
- valuation rules
- theme tokens and product terminology

## Isolation acceptance criteria

A branded build is not considered isolated merely because it redirects to the right screen at runtime. Its generated route root and dependency graph must contain shared code plus the selected niche module only. Other niche entry screens, prompts, attributes, and theme modules must be absent from the generated app bundle. The generic/master app is the only build allowed to expose multi-niche navigation.

Migration is incremental: move one niche at a time, add bundle-level checks, and keep current database schemas and eBay listing workflows intact.
