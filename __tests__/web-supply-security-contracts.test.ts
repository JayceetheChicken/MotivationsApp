import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import bundleScan from '../scripts/lib/bundle-scan.cjs';
import exportCsp from '../scripts/lib/export-csp-check.cjs';

const projectRoot = path.resolve(__dirname, '..');
const expoHydrationScript = 'globalThis.__EXPO_ROUTER_HYDRATE__=true;';
const expoHydrationHash = `sha256-${createHash('sha256').update(expoHydrationScript).digest('base64')}`;

function parseHeaderRules(content: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const sourceLine of content.split(/\r?\n/)) {
    if (!sourceLine.trim() || sourceLine.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(sourceLine)) {
      current = new Map();
      rules.set(sourceLine.trim(), current);
      continue;
    }
    const separator = sourceLine.indexOf(':');
    if (!current || separator === -1) continue;
    current.set(sourceLine.slice(0, separator).trim(), sourceLine.slice(separator + 1).trim());
  }
  return rules;
}

describe('hosted web security policy', () => {
  it('validates the entity-encoded CSP and exact inline bytes emitted in exported HTML', () => {
    const documents = [
      {
        file: '_headers',
        content: `/*\n  Content-Security-Policy: default-src 'self'; script-src 'self' '${expoHydrationHash}'`,
      },
      {
        file: 'index.html',
        content: '<meta http-equiv="Content-Security-Policy" '
          + `content="default-src &#x27;self&#x27;; script-src &#x27;self&#x27; &#x27;${expoHydrationHash}&#x27;">`
          + `<script>${expoHydrationScript}</script>`,
      },
    ];

    expect(exportCsp.collectExportCspIssues(documents)).toEqual([]);
    expect(exportCsp.collectExportCspIssues([
      documents[0],
      { ...documents[1], content: documents[1].content.replace('=true;', '=false;') },
    ]).join(' ')).toMatch(/Inline-Skript.*fehlt/);
  });

  it('allows same-origin Expo scripts globally and overrides the deletion page to scriptless', () => {
    const rules = parseHeaderRules(readFileSync(path.join(projectRoot, 'public', '_headers'), 'utf8'));
    const appPolicy = rules.get('/*')?.get('Content-Security-Policy');
    const deletionPolicy = rules.get('/account-deletion/*')?.get('Content-Security-Policy');

    expect(appPolicy).toContain("script-src 'self'");
    expect(appPolicy).not.toContain("script-src 'none'");
    expect(appPolicy).toContain(`'${expoHydrationHash}'`);
    expect(appPolicy).toContain("connect-src 'self';");
    expect(appPolicy).not.toContain('supabase.co');
    expect(appPolicy).toContain("img-src 'self' data: blob:");
    expect(deletionPolicy).toContain("script-src 'none'");
    expect(deletionPolicy).toContain("frame-ancestors 'none'");
  });

  it('keeps meta CSP as browser-side fallback without claiming header-only directives', () => {
    const appShell = readFileSync(path.join(projectRoot, 'src', 'app', '+html.tsx'), 'utf8');
    const deletionPage = readFileSync(
      path.join(projectRoot, 'public', 'account-deletion', 'index.html'),
      'utf8',
    );

    expect(appShell).toContain("script-src 'self'");
    expect(appShell).toContain(`'${expoHydrationHash}'`);
    expect(appShell).toContain("img-src 'self' data: blob:");
    expect(appShell).not.toMatch(/content="[^"]*frame-ancestors/);
    expect(appShell).not.toMatch(/httpEquiv="X-(?:Frame-Options|Content-Type-Options)"/);
    expect(deletionPage).toContain("script-src 'none'");
    expect(deletionPage).not.toMatch(/content="[^"]*frame-ancestors/);
  });
});

describe('export scanner filesystem boundaries', () => {
  it('reports a directory symlink and never follows it into untrusted content', () => {
    const exportRoot = mkdtempSync(path.join(tmpdir(), 'lernzeit-export-'));
    const outsideRoot = mkdtempSync(path.join(tmpdir(), 'lernzeit-outside-'));
    try {
      writeFileSync(path.join(outsideRoot, 'outside.js'), 'SUPABASE_SERVICE_ROLE_KEY="not-readable"');
      symlinkSync(outsideRoot, path.join(exportRoot, 'linked-assets'), 'junction');

      const scan = bundleScan.scanExportDirectory(exportRoot);
      expect(scan.scanned).toBe(0);
      expect(scan.findings).toEqual([]);
      expect(scan.unreadable).toEqual([{
        file: 'linked-assets',
        reason: expect.stringMatching(/Symbolische Links/),
      }]);
    } finally {
      rmSync(exportRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});
