# SWISH APK suite build — 3 November 2026

Source: 451725abcfc9d02a28c429dfb7123bbe93c6aa91
Includes:
- Immediate authenticated-user state update after confirmed sign-in.
- Auth listener bootstrap race fix and removal of stale auth module gate.
- Narrow authenticated-only auth.uid() schema/function grants for the SECURITY INVOKER listing editor.
- Regression guard for the listing editor permission boundary.

This marker exists only to trigger the repository's release/apk-suite workflow. It does not change application runtime behaviour.
