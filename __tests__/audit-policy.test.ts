import auditPolicy from '../scripts/lib/audit-policy.cjs';

function report(...advisories: { name: string; severity: string; url: string }[]) {
  const vulnerabilities: Record<string, unknown> = {};
  for (const advisory of advisories) {
    vulnerabilities[advisory.name] = {
      severity: advisory.severity,
      via: [{ ...advisory, source: 1, title: `${advisory.name} advisory`, range: '*' }],
    };
    // Transitive entries only reference the root advisory by package name.
    vulnerabilities[`parent-of-${advisory.name}`] = { severity: advisory.severity, via: [advisory.name] };
  }
  return { vulnerabilities, metadata: {} };
}

const exception = { ghsa: 'GHSA-aaaa-bbbb-cccc', package: 'braces', expires: '2026-12-15' };
const braces = { name: 'braces', severity: 'high', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' };

describe('dependency audit policy', () => {
  it('accepts only an exact, unexpired GHSA and package match', () => {
    expect(auditPolicy.evaluateAudit(report(braces), [exception], '2026-10-15')).toEqual({
      errors: [],
      accepted: [expect.objectContaining({ ghsa: 'GHSA-aaaa-bbbb-cccc', package: 'braces', expires: '2026-12-15' })],
    });

    const otherPackage = { ...braces, name: 'micromatch' };
    expect(auditPolicy.evaluateAudit(report(otherPackage), [exception], '2026-10-15').errors).toEqual([
      expect.stringContaining('Ungeprüfter Befund: micromatch'),
      expect.stringContaining('Ausnahme ohne Befund entfernen: braces'),
    ]);
  });

  it('fails on new findings, expired exceptions and unusable audit output', () => {
    const fresh = { name: 'shell-quote', severity: 'critical', url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff' };
    expect(auditPolicy.evaluateAudit(report(braces, fresh), [exception], '2026-10-15').errors).toEqual([
      expect.stringContaining('Ungeprüfter Befund: shell-quote critical GHSA-dddd-eeee-ffff'),
    ]);
    expect(auditPolicy.evaluateAudit(report(braces), [exception], '2026-12-16').errors).toEqual([
      expect.stringContaining('Ausnahme abgelaufen am 2026-12-15'),
    ]);
    expect(auditPolicy.evaluateAudit({ error: { code: 'ENOTFOUND' } }, [], '2026-10-15').errors).toHaveLength(1);
    expect(auditPolicy.evaluateAudit(null, [], '2026-10-15').errors).toHaveLength(1);
  });

  it('ignores low advisories like the previous moderate audit level', () => {
    const low = { name: 'tiny', severity: 'low', url: 'https://github.com/advisories/GHSA-1111-2222-3333' };
    expect(auditPolicy.evaluateAudit(report(low), [], '2026-10-15')).toEqual({ errors: [], accepted: [] });
  });

  it('keeps every shipped exception reviewed and short-lived', () => {
    for (const entry of auditPolicy.AUDIT_EXCEPTIONS) {
      expect(entry.ghsa).toMatch(/^GHSA(-[0-9a-z]{4}){3}$/);
      expect(entry.reason.length).toBeGreaterThan(40);
      expect(Date.parse(entry.expires)).toBeLessThanOrEqual(Date.parse('2027-01-31'));
    }
  });
});
