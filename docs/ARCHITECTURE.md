# RichKkok v1 architecture

## Boundaries and privacy

Vanilla ES modules render five routes: home, transactions, budget, analytics, settings. Import is a separate workflow. Pure modules (`budget`, `recurring`, `rules`, `analytics`, import normalization) do not depend on the DOM. `db.js` is the repository boundary for a future optional sync adapter; v1 has no server, analytics SDK, account login or financial network request.

IndexedDB stores one versioned household document atomically. Read-modify-write transactions prevent lost updates across tabs; BroadcastChannel refreshes open views. Real and fictional demonstration data use separate databases. Original import files remain only in memory and are released after import. Backup contains normalized data, never original financial files. Public defaults contain generic member names and no actual household income. A private setup file can apply household settings without publishing them or replacing existing transactions.

Personal-detail hiding suppresses merchants, notes and payment-method searching in shared views. It is a presentation preference, not encryption or PIN authentication. Anyone with device/browser access may access local data. Browsers and devices do not sync automatically; export an encrypted backup before changing browsers or clearing site data.

## Money model

All amounts are safe integer KRW. Direction (expense, income, refund, transfer), category and household scope are independent. Soft-deleted rows, split parents, transfers and excluded rows are omitted from expenditure. Refunds subtract once. Planned income and imported actual income are alternative modes, never added together.

Available = selected income − actual net expenditure − unmatched recurring remainder − monthly savings allocations. A recurring remainder is max(0, scheduled amount − linked actual net payment). Only an unambiguous configured merchant/payment/owner match auto-links a recurring charge; otherwise users link it manually. Future changes take effect on the occurrence's due date. Card eligible and unknown amounts are parallel metrics of existing rows, never additional expenditure. Eligibility is user-controlled rather than an assertion about a card contract.

Budgets use defaults plus monthly overrides. Insights require supporting records, use deterministic comparisons and suppress spending-reduction prompts for protected fixed-cost categories.

## Import and backup

CSV handles quoted commas/newlines and common Korean encodings. A worker uses locally vendored, checksum-pinned SheetJS CE 0.20.3 for XLS/XLSX, with automatic header detection and manual sheet/column mapping. Explicit transaction types take precedence over signs. For files without a type column, the preview offers card/refund or signed-bank conventions. Debit/credit columns are supported. Limits: 20 MB/file, 50,000 rows/file, 100,000 stored transactions; malformed rows require explicit skip consent.

SHA-256 identity combines owner, date/time, amount, normalized merchant, payment method, direction and identical-row occurrence. Reimports preserve same-file multiplicity and retain identities through edits, soft deletion and splitting. Overlapping exports lacking transaction identifiers cannot perfectly distinguish genuinely separate identical payments; preview remains essential.

Encrypted backups use WebCrypto PBKDF2-SHA256 (250,000 iterations, random 16-byte salt) and AES-256-GCM (random 12-byte IV). Wrong passwords and tampering fail before state replacement. Plain JSON export carries a privacy warning. Restore validates schema, safe amounts and hostile object keys before an atomic replacement.

## PWA and delivery

The build hashes shipped assets into a cache version. Installation precaches the complete shell and local spreadsheet parser; failed installs discard the partial cache. Navigation and allowlisted assets use the matching cached release for coherent offline execution. Updates wait for an explicit user action; activation deletes only older RichKkok caches. IndexedDB is independent of asset caches and retained through upgrades.

GitHub Actions checks syntax/security boundaries, runs automated tests, builds and deploys the static `dist` directory. On initial bootstrap only, the official pinned parser is checksum-verified and committed to the repository. Subsequent builds use that local vendor file. First-time Pages activation may require an administrator to select GitHub Actions as source; the standard workflow token cannot grant itself repository administration.

Responsive navigation adapts at tablet/mobile widths. Safe-area padding, 16px inputs, 44px targets, keyboard/native dialogs and reduced motion are part of the shared design. Browser viewport checks do not replace testing on physical iPhone/iPad Safari devices.
