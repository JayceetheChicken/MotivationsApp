'use strict';

// SHA-256 of the androiddebugkey shipped in every React Native/Expo template
// (store password "android"). Anyone can sign with it.
const PUBLIC_DEBUG_CERT_SHA256 = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c';

function normalizeDigest(value) {
  return String(value ?? '').trim().replace(/:/g, '').toLowerCase();
}

/**
 * Checks `apksigner verify --print-certs` output: exactly one signer whose
 * certificate matches the expected release fingerprint, never the public
 * template debug key.
 */
function checkApkSigner(printCertsOutput, expectedSha256) {
  const errors = [];
  const expected = normalizeDigest(expectedSha256);
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    errors.push('Erwarteter Zertifikats-Fingerabdruck (ANDROID_RELEASE_CERT_SHA256) fehlt oder ist ungültig.');
  }
  const digests = [...String(printCertsOutput).matchAll(/^Signer #\d+ certificate SHA-256 digest: ([0-9a-f:]+)\s*$/gim)]
    .map((match) => normalizeDigest(match[1]));
  if (digests.length !== 1) {
    errors.push(`Genau ein Signer erwartet, gefunden: ${digests.length}.`);
  }
  if (digests.includes(PUBLIC_DEBUG_CERT_SHA256)) {
    errors.push('APK ist mit dem öffentlichen React-Native-Debug-Schlüssel signiert.');
  } else if (expected && digests.length === 1 && digests[0] !== expected) {
    errors.push(`Signer ${digests[0]} entspricht nicht dem Release-Schlüssel ${expected}.`);
  }
  return { errors, digests };
}

module.exports = { PUBLIC_DEBUG_CERT_SHA256, checkApkSigner };
