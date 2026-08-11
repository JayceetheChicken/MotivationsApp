import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import installPolicy from '../scripts/lib/install-script-policy.cjs';

const SYNTHETIC_SHA512 = `sha512-${Buffer.alloc(64, 0x42).toString('base64')}`;
const ALTERED_SHA512 = `sha512-${Buffer.alloc(64, 0x24).toString('base64')}`;

function syntheticLockfile() {
  const packages: Record<string, Record<string, unknown>> = { '': {} };
  for (const entry of installPolicy.VETTED_INSTALL_SCRIPTS) {
    packages[entry.lockPath] = {
      version: entry.version,
      resolved: entry.resolved,
      integrity: entry.integrity,
      hasInstallScript: true,
      ...(entry.os.length > 0 ? { os: [...entry.os] } : {}),
      ...(entry.cpu.length > 0 ? { cpu: [...entry.cpu] } : {}),
    };
  }
  return { lockfileVersion: 3, packages };
}

describe('npm install-script policy', () => {
  it('requires the repository-wide ignore-scripts default', () => {
    expect(installPolicy.validateNpmConfiguration('# safe default\nignore-scripts=true\n')).toEqual([]);
    expect(installPolicy.validateNpmConfiguration('ignore-scripts=false\n')).toEqual([
      expect.stringContaining('ignore-scripts=true'),
    ]);
    expect(installPolicy.validateNpmConfiguration('fund=false\n')).toEqual([
      expect.stringContaining('ignore-scripts=true'),
    ]);
  });

  it('accepts only the exact reviewed lockfile entries', () => {
    expect(installPolicy.validateLockfile(syntheticLockfile()).errors).toEqual([]);
  });

  it('rejects a newly introduced lifecycle package before installation', () => {
    const lockfile = syntheticLockfile();
    lockfile.packages['node_modules/surprise-hook'] = {
      version: '1.0.0',
      resolved: 'https://registry.npmjs.org/surprise-hook/-/surprise-hook-1.0.0.tgz',
      integrity: SYNTHETIC_SHA512,
      hasInstallScript: true,
    };

    expect(installPolicy.validateLockfile(lockfile).errors).toEqual([
      expect.stringContaining('surprise-hook@1.0.0'),
    ]);
  });

  it.each([
    ['version', '9.9.9'],
    ['integrity', ALTERED_SHA512],
    ['resolved', 'https://registry.npmjs.org/unrs-resolver/-/unrs-resolver-9.9.9.tgz'],
    ['os', ['darwin']],
    ['cpu', ['arm64']],
  ] as const)('rejects altered %s metadata', (field, value) => {
    const lockfile = syntheticLockfile();
    lockfile.packages['node_modules/unrs-resolver'][field] = value;

    expect(installPolicy.validateLockfile(lockfile).errors).toEqual([
      expect.stringContaining(`unrs-resolver: ${field}`),
    ]);
  });

  it('requires every registry package to use the trusted registry and SHA-512 pin', () => {
    const lockfile = syntheticLockfile();
    lockfile.packages['node_modules/no-pin'] = {
      version: '1.0.0',
      resolved: 'https://registry.npmjs.org/no-pin/-/no-pin-1.0.0.tgz',
    };
    lockfile.packages['node_modules/other-registry'] = {
      version: '1.0.0',
      resolved: 'https://packages.example.test/other-registry-1.0.0.tgz',
      integrity: SYNTHETIC_SHA512,
    };

    expect(installPolicy.validateLockfile(lockfile).errors).toEqual(expect.arrayContaining([
      expect.stringContaining('no-pin: Registry-Paket braucht'),
      expect.stringContaining('other-registry: resolved muss'),
    ]));
  });

  it('allows only explicit, repository-contained local package links', () => {
    const lockfile = syntheticLockfile();
    lockfile.packages['node_modules/local-fork'] = {
      resolved: 'vendor/local-fork',
      link: true,
    };
    lockfile.packages['vendor/local-fork'] = {
      version: '1.0.0+local.1',
      license: 'MIT',
    };
    expect(installPolicy.validateLockfile(lockfile).errors).toEqual([]);

    lockfile.packages['node_modules/local-fork'].resolved = '../outside';
    expect(installPolicy.validateLockfile(lockfile).errors).toEqual(expect.arrayContaining([
      expect.stringContaining('lokales Link-Ziel ist nicht eindeutig'),
      expect.stringContaining('unerwarteter lokaler Paket-Eintrag'),
    ]));
  });

  it('uses lockfile OS restrictions when selecting rebuilds', () => {
    const fsevents = installPolicy.VETTED_INSTALL_SCRIPTS[0];
    const resolver = installPolicy.VETTED_INSTALL_SCRIPTS[1];

    expect(installPolicy.appliesToPlatform(fsevents, 'linux', 'x64')).toBe(false);
    expect(installPolicy.appliesToPlatform(fsevents, 'darwin', 'arm64')).toBe(true);
    expect(installPolicy.appliesToPlatform(resolver, 'linux', 'x64')).toBe(true);
    expect(installPolicy.appliesToPlatform(resolver, 'win32', 'x64')).toBe(true);
  });

  it('rejects a changed extracted lifecycle command before rebuilding', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'lernzeit-install-policy-'));
    try {
      const resolver = installPolicy.VETTED_INSTALL_SCRIPTS[1];
      const packageDirectory = path.join(root, resolver.lockPath);
      mkdirSync(packageDirectory, { recursive: true });
      writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({
        name: resolver.name,
        version: resolver.version,
        scripts: { postinstall: 'node unexpected.js' },
      }));

      const result = installPolicy.validateInstalledPackages(root, {
        platform: 'linux',
        arch: 'x64',
        policy: [resolver],
      });
      expect(result.errors).toEqual([expect.stringContaining('unexpected.js')]);
      expect(result.applicable).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
