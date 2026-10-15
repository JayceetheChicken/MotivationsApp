import signerCheck from '../scripts/lib/apk-signer-check.cjs';

const RELEASE = '78a806ef823990f18a9fd1523214f02edbd855df1d16fd75cda5b4a75e964bc8';

function printCerts(...digests: string[]) {
  return digests.map((digest, index) => [
    `Signer #${index + 1} certificate DN: CN=Lernzeit, O=Lernzeit, C=DE`,
    `Signer #${index + 1} certificate SHA-256 digest: ${digest}`,
    `Signer #${index + 1} certificate SHA-1 digest: 2b6343b1852e84e777bebc5939c17600681baf5f`,
  ].join('\n')).join('\n');
}

describe('APK signer check', () => {
  it('accepts exactly the expected release certificate', () => {
    expect(signerCheck.checkApkSigner(printCerts(RELEASE), RELEASE)).toEqual({ errors: [], digests: [RELEASE] });
    const colonSeparated = RELEASE.toUpperCase().match(/../g)!.join(':');
    expect(signerCheck.checkApkSigner(printCerts(RELEASE), colonSeparated).errors).toEqual([]);
  });

  it('rejects the public template debug key even if it was configured as expected', () => {
    const debug = signerCheck.PUBLIC_DEBUG_CERT_SHA256;
    expect(signerCheck.checkApkSigner(printCerts(debug), RELEASE).errors).toEqual([
      expect.stringContaining('öffentlichen React-Native-Debug-Schlüssel'),
    ]);
    expect(signerCheck.checkApkSigner(printCerts(debug), debug).errors).toEqual([
      expect.stringContaining('öffentlichen React-Native-Debug-Schlüssel'),
    ]);
  });

  it('rejects other keys, extra signers and a missing expectation', () => {
    const other = 'ab'.repeat(32);
    expect(signerCheck.checkApkSigner(printCerts(other), RELEASE).errors).toEqual([
      expect.stringContaining('entspricht nicht dem Release-Schlüssel'),
    ]);
    expect(signerCheck.checkApkSigner(printCerts(RELEASE, other), RELEASE).errors).toEqual([
      expect.stringContaining('Genau ein Signer erwartet, gefunden: 2'),
    ]);
    expect(signerCheck.checkApkSigner(printCerts(RELEASE), '').errors).toEqual([
      expect.stringContaining('ANDROID_RELEASE_CERT_SHA256'),
    ]);
  });
});
