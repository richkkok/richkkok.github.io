# Vendored spreadsheet reader

SheetJS Community Edition **0.20.3**, full standalone distribution with XLS and codepage support.

- Official source: https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
- Documentation: https://docs.sheetjs.com/docs/getting-started/installation/standalone/
- SHA-256: `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`
- License: Apache-2.0 (see LICENSE-SheetJS.txt and embedded library notice).

`scripts/vendor.mjs` downloads only if absent, verifies this exact checksum, and writes the library to this directory. The deployed site reads this local copy in a local worker; no financial file or data is sent to SheetJS. The Pages workflow commits the verified vendor file on initial bootstrap if necessary. Later builds require the same checksum and do not silently upgrade.
