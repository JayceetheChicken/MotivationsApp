# CommonJS distribution of upstream 0.5.0, plus a literal replacement pass

Source: https://registry.npmjs.org/decode-uri-component/-/decode-uri-component-0.5.0.tgz

Upstream tarball SHA-1: `4592fa1e1d640ec5e2760e2e168ad2ab5f2c9da1`.

This contains the upstream fix for GHSA-vcc3-ghjq-m6fr. Expo Router 57
requires query-string 7, which calls `require('decode-uri-component')` as a
function. Upstream 0.5.0 is ESM-only, so overriding its version alone would
break query parsing.

## JavaScript changes against the upstream tarball

1. The default function export becomes `module.exports` (and gains its
   terminating semicolon), so query-string 7 can `require()` it.
2. The final replacement pass in `customDecodeURIComponent` uses
   `input.split(key).join(replaceMap[key])` instead of
   `input.replace(new RegExp(key, 'g'), replaceMap[key])`.

Change 2 fixes two upstream defects that both reach the decoder from any
attacker-supplied URL or deep link. Every `replaceMap` key is a literal run of
`%XX` bytes, which contains no regular-expression metacharacters, so a literal
split/join produces the same substitution — except where upstream misbehaves:

- **Crash on long runs.** `new RegExp` rejects a pattern past the engine's
  program-size limit with `SyntaxError: Invalid regular expression: too large`.
  A percent-encoded run of a few thousand bytes therefore threw out of
  `query-string.parse`, past the `try`/`catch` that is supposed to make this
  decoder total.
- **`$` expansion in decoded values.** `String.prototype.replace` interprets
  `$$`, `$&`, `` $` ``, `$'` and `$n` inside the *replacement* string. Because
  the replacement is decoded user data, `%24%26` (`$&`) duplicated the
  surrounding input and `%24%27` (`$'`) silently dropped it — for example
  upstream decodes `%FF%24%27` to `%FF`, losing the `$'`. A literal join
  performs no such expansion.

The decoding algorithm itself (`parsePercentByte`, `utf8SequenceLength`,
`decode`) and the MIT license are unchanged. The build metadata
`+lernzeit.cjs.2` identifies this packaging and patch without claiming a new
upstream release or sorting below the patched 0.5.0 version.

No advisory is suppressed. `__tests__/uri-decoder-security.test.ts` exercises
query-string's actual resolution, Unicode and duplicate query parameters, the
`$`-expansion regressions, and a long malformed run under a subprocess timeout.
Remove this distribution when the SDK uses a compatible patched
query-string/decoder combination that carries both fixes upstream.
