import {
  normalizeSubjectSearch,
  resolveCatalogSubjectName,
  searchSubjectCatalog,
} from '@/data/subject-catalog';

describe('subject catalog', () => {
  it('finds canonical subjects through common aliases', () => {
    expect(resolveCatalogSubjectName('Mathe')).toBe('Mathematik');
    expect(resolveCatalogSubjectName('Erdkunde')).toBe('Geografie');
    expect(resolveCatalogSubjectName('BWR')).toBe('Rechnungswesen');
  });

  it('searches without depending on accents, case or punctuation', () => {
    expect(searchSubjectCatalog('FRANZOESISCH')[0]?.name).toBe('Französisch');
    expect(searchSubjectCatalog('politik gesellschaft')[0]?.name).toBe('Politik und Gesellschaft');
    expect(normalizeSubjectSearch('  Wirtschaft & Recht  ')).toBe('wirtschaft recht');
    expect(normalizeSubjectSearch('STRAẞE')).toBe('strasse');
  });

  it('leaves unknown names available for the free-entry fallback', () => {
    expect(resolveCatalogSubjectName('Robotik-Werkstatt')).toBeNull();
    expect(searchSubjectCatalog('Robotik-Werkstatt')).toEqual([]);
  });
});
