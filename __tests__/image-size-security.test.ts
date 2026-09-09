import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '..');
const forkPath = path.join(projectRoot, 'vendor', 'image-size');

function runInstalledPackageInChild(input: Uint8Array) {
  const script = [
    "const imageSize = require('image-size');",
    `const input = Uint8Array.from(${JSON.stringify(Array.from(input))});`,
    'try { imageSize(input); } catch (error) {',
    "  if (!(error instanceof Error)) process.exit(2);",
    '}',
    "process.stdout.write('completed');",
  ].join('\n');

  return spawnSync(process.execPath, ['-e', script], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 1_500,
    windowsHide: true,
  });
}

function malformedIcns(): Uint8Array {
  const input = Buffer.alloc(16);
  input.write('icns', 0, 'ascii');
  input.writeUInt32BE(input.length, 4);
  input.write('ic07', 8, 'ascii');
  input.writeUInt32BE(0, 12);
  return input;
}

function malformedJxl(): Uint8Array {
  const input = Buffer.alloc(40);
  input.writeUInt32BE(12, 0);
  input.write('JXL ', 4, 'ascii');
  input.writeUInt32BE(12, 12);
  input.write('ftyp', 16, 'ascii');
  input.write('jxl ', 20, 'ascii');
  input.writeUInt32BE(0, 24);
  input.write('jxlp', 28, 'ascii');
  return input;
}

function malformedHeif(): Uint8Array {
  const input = Buffer.alloc(32);
  input.writeUInt32BE(12, 0);
  input.write('ftyp', 4, 'ascii');
  input.write('avif', 8, 'ascii');
  input.writeUInt32BE(20, 12);
  input.write('meta', 16, 'ascii');
  input.writeUInt32BE(0, 24);
  input.write('junk', 28, 'ascii');
  return input;
}

function truncatedIcns(): Uint8Array {
  const input = Buffer.alloc(16);
  input.write('icns', 0, 'ascii');
  input.writeUInt32BE(24, 4);
  input.write('ic07', 8, 'ascii');
  input.writeUInt32BE(16, 12);
  return input;
}

function validIcns(): Uint8Array {
  const input = Buffer.alloc(16);
  input.write('icns', 0, 'ascii');
  input.writeUInt32BE(input.length, 4);
  input.write('ic07', 8, 'ascii');
  input.writeUInt32BE(8, 12);
  return input;
}

describe('vendored image-size security fork', () => {
  it('is the package resolved by the installed dependency tree and lockfile', () => {
    const manifestPath = require.resolve('image-size/package.json', { paths: [projectRoot] });
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      version?: string;
      lernzeitSecurityFork?: { upstreamIntegrity?: string; advisories?: string[] };
    };
    const lock = JSON.parse(readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8')) as {
      packages?: Record<string, { link?: boolean; resolved?: string; version?: string }>;
    };

    expect(realpathSync(manifestPath)).toBe(realpathSync(path.join(forkPath, 'package.json')));
    expect(manifest).toMatchObject({
      version: '1.2.1-lernzeit.1',
      lernzeitSecurityFork: {
        upstreamIntegrity: 'sha512-rH+46sQJ2dlwfjfhCyNx5thzrv+dtmBIhPHk0zgRUukHzZ/kRueTJXoYYsclBaKcSMBWuGbOFXtioLpzTb5euw==',
        advisories: ['GHSA-w3rx-r6r6-pgpr', 'GHSA-5p2g-fcmc-qvqq'],
      },
    });
    expect(lock.packages?.['node_modules/image-size']).toMatchObject({
      link: true,
      resolved: 'vendor/image-size',
    });
    expect(lock.packages?.['vendor/image-size']?.version).toBe('1.2.1-lernzeit.1');

    const installedImageSizeEntries = Object.keys(lock.packages ?? {})
      .filter((lockPath) => /(?:^|\/)node_modules\/image-size$/.test(lockPath));
    expect(installedImageSizeEntries).toEqual(['node_modules/image-size']);

    const metroManifestPath = require.resolve('metro/package.json', { paths: [projectRoot] });
    const metroImageSizeManifestPath = require.resolve('image-size/package.json', {
      paths: [path.dirname(metroManifestPath)],
    });
    expect(realpathSync(metroImageSizeManifestPath)).toBe(
      realpathSync(path.join(forkPath, 'package.json')),
    );
  });

  it.each([
    ['a zero-length ICNS entry', malformedIcns()],
    ['an ICNS entry truncated before its declared boundary', truncatedIcns()],
    ['a zero-size JXL partial-stream box', malformedJxl()],
    ['a zero-size HEIF child box', malformedHeif()],
  ])('terminates for %s', (_label, input) => {
    const result = runInstalledPackageInChild(input);

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('completed');
  });

  it('normalizes a zero-size HEIF box to the remaining input', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { findBox } = require('image-size/dist/types/utils') as {
      findBox: (
        input: Uint8Array,
        name: string,
        offset: number,
      ) => { name: string; offset: number; size: number } | undefined;
    };
    const input = Buffer.alloc(20);
    input.writeUInt32BE(0, 4);
    input.write('ispe', 8, 'ascii');

    expect(findBox(input, 'ispe', 4)).toEqual({ name: 'ispe', offset: 4, size: 16 });
  });

  it('preserves ordinary PNG dimension parsing', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const imageSize = require('image-size') as (
      input: Uint8Array,
    ) => { width: number; height: number; type?: string };
    const pngHeader = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(pngHeader, 0);
    pngHeader.write('IHDR', 12, 'ascii');
    pngHeader.writeUInt32BE(37, 16);
    pngHeader.writeUInt32BE(19, 20);

    expect(imageSize(pngHeader)).toMatchObject({ width: 37, height: 19, type: 'png' });
  });

  it('preserves a valid ICNS entry', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const imageSize = require('image-size') as (
      input: Uint8Array,
    ) => { width: number; height: number; type?: string };

    expect(imageSize(validIcns())).toMatchObject({ width: 128, height: 128, type: 'ic07' });
  });
});
