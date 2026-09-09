import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const requireFromRoot = createRequire(path.join(root, 'package.json'));
const requireFromQueryString = createRequire(requireFromRoot.resolve('query-string'));
const decodeUriComponent = requireFromRoot(
  requireFromQueryString.resolve('decode-uri-component'),
) as (value: string) => string;

describe('patched URI decoder used by Expo Router', () => {
  it('resolves query-string to the reviewed patched CommonJS distribution', () => {
    expect(requireFromQueryString.resolve('decode-uri-component'))
      .toBe(path.join(root, 'vendor', 'decode-uri-component', 'index.js'));
    const query = requireFromRoot('query-string');
    expect(query.parse('name=Gr%C3%BC%C3%9Fe&tag=a&tag=b&space=hello+world'))
      .toEqual({ name: 'Grüße', tag: ['a', 'b'], space: 'hello world' });
    expect(query.stringify({ name: 'Grüße' })).toBe('name=Gr%C3%BC%C3%9Fe');
  });

  it('finishes malformed percent decoding within a hard process timeout', () => {
    const result = spawnSync(process.execPath, ['-e', `
      const query = require('query-string');
      const value = '%FF'.repeat(20000) + '%C3%A4';
      const decoded = query.parse('value=' + value).value;
      if (!decoded.endsWith('ä')) process.exit(1);
    `], { cwd: root, timeout: 5000, encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });

  // A percent-encoded run longer than the regular-expression program-size limit
  // must not throw: the decoder is the last line of defence for deep-link URLs.
  it('decodes a percent-encoded run too long to compile as a pattern', () => {
    const run = '%FF'.repeat(20000);
    expect(() => decodeUriComponent(run)).not.toThrow();
    expect(decodeUriComponent(`${run}%C3%A4`).endsWith('ä')).toBe(true);
  });

  // Decoded user data is used as a replacement string, so `$` sequences must be
  // substituted literally rather than expanded into the surrounding match.
  it.each([
    ['%FF%24%26', '%FF$&'],
    ['%FF%24%24', '%FF$$'],
    ["%FF%24%27", "%FF$'"],
    ['%FF%24%60', '%FF$`'],
  ])('substitutes %s literally without expanding $ patterns', (input, expected) => {
    expect(decodeUriComponent(input)).toBe(expected);
  });

  it('keeps upstream replacement-character behaviour for byte-order marks', () => {
    expect(decodeUriComponent('%FE%FF')).toBe('��');
    expect(decodeUriComponent('%FF%FE')).toBe('��');
    expect(decodeUriComponent('%C2')).toBe('�');
    expect(decodeUriComponent('%E2%82%AC')).toBe('€');
    expect(decodeUriComponent('a%FFb')).toBe('a%FFb');
  });
});
