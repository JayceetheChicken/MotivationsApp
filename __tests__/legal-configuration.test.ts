import { resolveLegalSiteBaseUrl } from '@/legal/configuration';

describe('legal site configuration', () => {
  it('accepts only a clean HTTPS origin or base path', () => {
    expect(resolveLegalSiteBaseUrl('https://legal.example.com/lernzeit/')).toBe(
      'https://legal.example.com/lernzeit',
    );
  });

  it.each([
    'http://legal.example.com',
    'javascript:alert(1)',
    'https://user:password@legal.example.com',
    'https://legal.example.com?token=value',
    'https://legal.example.com/#fragment',
    'not a URL',
  ])('falls back safely for invalid public legal URL %s', (value) => {
    expect(resolveLegalSiteBaseUrl(value)).toBe('https://lernzeit.example.invalid');
  });
});
