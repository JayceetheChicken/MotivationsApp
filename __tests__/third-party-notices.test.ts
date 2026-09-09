import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '..');

describe('third-party notice provenance', () => {
  it('records the installed local image-size security fork instead of an unknown link version', () => {
    const lockfile = JSON.parse(readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
    const forkManifest = JSON.parse(
      readFileSync(path.join(projectRoot, 'vendor', 'image-size', 'package.json'), 'utf8'),
    );
    const notices = readFileSync(path.join(projectRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');

    expect(lockfile.packages['node_modules/image-size']).toEqual({
      resolved: 'vendor/image-size',
      link: true,
    });
    expect(lockfile.packages['vendor/image-size'].version).toBe(forkManifest.version);
    expect(notices).toContain(`### image-size@${forkManifest.version}`);
    expect(notices).toContain('Bezugsquelle: lokal versioniertes Paket `vendor/image-size`');
    expect(notices).toContain(`Modifizierter Lernzeit-Sicherheitsfork von \`image-size@${forkManifest.lernzeitSecurityFork.upstreamVersion}\``);
    expect(notices).toContain(forkManifest.lernzeitSecurityFork.upstreamGitHead);
    expect(notices).not.toContain('### image-size@unbekannt');
    expect(notices).not.toContain('Integrity-Hashes eindeutig');
  });

  it('is byte-for-byte current according to the generator', () => {
    expect(() => execFileSync(process.execPath, [
      path.join(projectRoot, 'scripts', 'build-third-party-notices.mjs'),
      '--check',
    ], { cwd: projectRoot, stdio: 'pipe' })).not.toThrow();
  });
});
