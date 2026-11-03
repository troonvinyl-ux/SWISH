# SWISH OTA authentication and APK release

Release source: merged PR #160.

This release branch exists to run the existing complete Android APK suite against the merged OTA/authentication fix.

Required release checks:
- Shared Supabase client reads the Expo runtime manifest when OTA build-time environment variables are absent.
- Public Supabase URL and anon key are embedded in every branded niche APK and the Master Admin APK.
- EAS project ID, runtime version and OTA channel are verified before Android compilation.
- Each APK passes the existing ZIP, signature, package identity, app label, target SDK and launcher checks.

This marker is documentation only. Application code and native configuration come from the merged main branch.
