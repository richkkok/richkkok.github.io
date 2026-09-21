# Validation record

Local validation: 2026-09-17–18. This record does not claim a production deployment or physical Safari testing.

## Automated

`pnpm run check`, `pnpm test`, `pnpm run build` pass. 23 tests cover CSV quoting/encodings, real XLS/XLSX binary round trips, header mapping, Korean/Excel dates, signs/refunds/zero, settlement exclusion, stable repeat-import identities, rule precedence, monthly budgets, recurring matching/future changes, card metrics, split/delete/restore, private search, protected-cost insights, IndexedDB isolation/concurrency, encrypted backup/wrong-password/tamper rejection, restore validation, offline shell/cache activation, UI escaping/labels and component boundaries.

## Browser flows

- Onboarding and fictional demo isolation; real workspace setup and navigation.
- Synthetic XLSX imported 5 rows: expense 23,100 + expense 6,500 − refund 3,100 = net 26,500 KRW; settlement 23,100 excluded; zero row preserved.
- Same content as CSV: 0 new / 5 duplicate. Changing owner: 5 new rows; household net 53,000 KRW.
- Saved card eligibility and exact merchant rule; home shows eligible 23,100 without changing household expenditure.
- Split a 6,500 KRW row into 3,250 shared + 3,250 personal: aggregate remains 53,000; personal merchant masked.
- Soft delete, trash filter and restore; same XLS reimport after edits and split still reports 0 new / 5 duplicates.
- Applied service-worker updates through the visible update button; transactions and settings retained.
- Stopped the local HTTP server, reloaded the controlled app and navigated between transactions and home: shell and stored records remained usable offline. Server restarted afterwards.
- Captured Chromium viewport checks of all five routes at 360×800, 390×844, 768×1024, 1024×768 and 1440×900. No document horizontal overflow. Visible action targets at least 44px; input font sizes at least 16px. Mobile long-form dialog scrolls internally with a visible footer.
- Browser console: no application errors/warnings in tested flows. The desktop row chevron nesting, compact transaction text and tablet brand target were corrected during visual QA.

## Actual limits

No bank login, cloud sync, automatic shared account access, PIN authentication or external AI. Privacy mode is visual masking. Real production-bank exports were not supplied; representative synthetic exports and manual mapping were tested. Password-protected spreadsheets are not supported. Browser-based size checks are not physical iPhone/iPad Safari tests. Home-screen installation requires a browser supporting the platform's PWA flow.

## Production checks

The app is reachable at https://richkkok.github.io. All 43 shipped resources, including the manifest, icons, service worker and local spreadsheet parser, returned HTTP 200 and matched the tested local build byte-for-byte (2026-09-18). A private setup file was applied through the visible restore workflow on the live origin; its settings and four recurring items survived reload. No actual household values or original files are included in this repository. Live tablet navigation across all five routes passed without horizontal overflow or undersized targets.

The initial custom deploy-pages job competed with the repository's already-active main/root Pages deployment and timed out during CDN purging. Deployment now has one owner: GitHub's built-in Pages workflow. The separate quality workflow runs the tests and verifies the committed service-worker release, without issuing another deployment.
