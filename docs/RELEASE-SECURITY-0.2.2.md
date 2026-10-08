# v0.2.2 security review — 2026-10-08

- Reviewed both repositories and reachable Git history (378 blobs): no privileged credential candidates found. Public Microsoft application ID and Supabase anon configuration are intentional. Test credentials are synthetic.
- Reviewed Electron trusted-sender IPC, renderer isolation/sandbox, denied permissions, secure session storage, token-redacted logging, appearance account boundaries, archive traversal checks, verified downloads and updater artifact selection.
- Read-only live Supabase catalog/advisor review: all 11 application tables have RLS. Messages are scoped to participants; sending requires friendship. Admin membership and verified Minecraft linking cannot be written/called by normal users. Public badge lookup returns only verified Minecraft UUIDs and is intentionally public. Private no-policy tables deny direct client access. No production data/schema was modified.
- Enable Supabase leaked-password protection when supported by the project plan: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- Patched source-map-js to 1.2.2 and overrode concurrently's exact vulnerable shell-quote dependency with compatible 1.12.0. Previous http-cache-semantics fix is retained.
- Remaining advisory GHSA-hp3w-g68c-fv3c affects sprintf-js 1.1.3 in electron-builder's download logging chain. No patched published version is available. No user-provided formatting templates are supplied during these builds; this development dependency is not shipped as an application dependency. This residual build-tool risk is documented rather than hidden by audit exclusions.
- Website uses escaped static templates and local assets, has no dependencies, credentials, forms or dynamic remote HTML. Added a restrictive Content Security Policy. Existing private/cache/build ignore rules remain effective.
- Automated regression tests cover auth, RLS, imports, downloads, filesystem boundaries, appearance and updates. Real-account skin/cape changes and Windows gameplay remain manual checks; this audit is not a penetration test or guarantee of absence of vulnerabilities. Installers remain unsigned.

The v0.2.1 candidate was not published: its new archive audit did not normalize Windows paths. That check is corrected in v0.2.2; no prior tag was rewritten.
