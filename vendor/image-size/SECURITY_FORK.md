# Lernzeit security fork

This directory is a reviewable fork of the published `image-size@1.2.1` npm
artifact. It is used only because Metro depends on that release and no patched
upstream version exists for the following reviewed advisories as of 2026-08-09.
The local package version is `1.2.1-lernzeit.1`: the prerelease suffix records
that the bytes differ without pretending that upstream published a newer fix.
The fork marker and exact upstream integrity below remain the authoritative
installed-byte proof; registry advisory lookup alone cannot verify local code.

- `GHSA-w3rx-r6r6-pgpr` / `CVE-2025-71330` (zero-length ICNS entry)
- `GHSA-5p2g-fcmc-qvqq` / `CVE-2025-71329` (zero-size JXL/HEIF box)

Upstream provenance:

- version: `1.2.1`
- git head: `a4178fbb334ddb22d94cb4228ed597c24fd02e10`
- npm integrity: `sha512-rH+46sQJ2dlwfjfhCyNx5thzrv+dtmBIhPHk0zgRUukHzZ/kRueTJXoYYsclBaKcSMBWuGbOFXtioLpzTb5euw==`
- tarball: `https://registry.npmjs.org/image-size/-/image-size-1.2.1.tgz`

Local changes are deliberately limited to:

1. normalizing a zero-sized ISO BMFF box to the remaining input and rejecting
   undersized box headers, so JXL/HEIF searches always advance;
2. validating JXL partial-stream offsets before advancing;
3. rejecting zero, undersized, truncated, or out-of-range ICNS entries; and
4. removing development/package lifecycle scripts from the vendored manifest.

The root regression suite executes crafted ICNS, JXL, and HEIF inputs in child
processes with a hard timeout and resolves `image-size` through the installed
dependency tree, so a stale registry install cannot satisfy the tests. The two
OSV exceptions in the root scanner configuration are intentionally limited to
these reviewed advisories and expire on 2026-11-09. Remove the fork, override,
and exceptions as soon as Metro resolves to an upstream `image-size` release
that both advisories mark as patched and the regression tests pass against it.
