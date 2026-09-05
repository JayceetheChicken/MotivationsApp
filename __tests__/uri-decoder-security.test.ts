import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const requireFromRoot = createRequire(path.join(root, 'package.json'));
const requireFromQueryString = createRequire(requireFromRoot.resolve('query-string'));

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
});
