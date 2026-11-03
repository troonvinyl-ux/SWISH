# APK suite retry — 3 November 2026

Source commit: 40be2797539470201dddc9b4b7394d126d7742df

The prior Android release jobs failed in D8 dex merging with Java heap exhaustion.
The niche and Master Admin Gradle invocations now use a 5 GiB heap and one worker
to reduce peak memory pressure. This file triggers the full release APK workflow.
