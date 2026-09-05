# CommonJS distribution of upstream 0.5.0

Source: https://registry.npmjs.org/decode-uri-component/-/decode-uri-component-0.5.0.tgz

Upstream tarball SHA-1: `4592fa1e1d640ec5e2760e2e168ad2ab5f2c9da1`.

This contains the upstream fix for GHSA-vcc3-ghjq-m6fr. Expo Router 57
requires query-string 7, which calls `require('decode-uri-component')` as a
function. Upstream 0.5.0 is ESM-only, so overriding its version alone would
break query parsing. The only JavaScript change is replacing the default
function export with `module.exports` (and its terminating semicolon).
The decoder algorithm and MIT license are unchanged. The build metadata
`+lernzeit.cjs.1` identifies this packaging change without claiming a new
upstream release or sorting below the patched 0.5.0 version.

No advisory is suppressed. Tests exercise query-string's actual resolution,
Unicode/duplicate query parameters and malformed input under a subprocess
timeout. Remove this distribution when the SDK uses a compatible patched
query-string/decoder combination.
