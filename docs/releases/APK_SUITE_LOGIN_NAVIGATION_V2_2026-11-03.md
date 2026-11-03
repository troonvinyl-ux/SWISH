# SWISH APK suite retry — explicit login navigation v2

Date: 3 November 2026
Source commit: e3e9ffc28554b5c1fba1bf7c09af8f168199187b

Build all ten isolated niche APKs and the Master Admin launcher with explicit post-authentication navigation from the standalone login screen and a visible error when an auth response contains no user.

Release gates: TypeScript, regression tests, public backend runtime configuration validation, Android APK compilation, package identity/signature inspection and artifact upload.

This workflow does not apply database migrations or prove live OnSpace authenticated-user behavior.
