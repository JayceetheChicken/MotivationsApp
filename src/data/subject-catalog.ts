export interface SubjectCatalogEntry {
  name: string;
  aliases?: readonly string[];
  common?: boolean;
}

export const subjectCatalog: readonly SubjectCatalogEntry[] = [
  { name: 'Deutsch', aliases: ['Germanistik'], common: true },
  { name: 'Mathematik', aliases: ['Mathe'], common: true },
  { name: 'Englisch', aliases: ['English'], common: true },
  { name: 'Französisch', aliases: ['Franzoesisch', 'French'], common: true },
  { name: 'Latein', aliases: ['Latin'], common: true },
  { name: 'Spanisch', aliases: ['Spanish'], common: true },
  { name: 'Italienisch', aliases: ['Italian'] },
  { name: 'Russisch', aliases: ['Russian'] },
  { name: 'Altgriechisch', aliases: ['Griechisch', 'Ancient Greek'] },
  { name: 'Türkisch', aliases: ['Tuerkisch', 'Turkish'] },
  { name: 'Arabisch', aliases: ['Arabic'] },
  { name: 'Chinesisch', aliases: ['Mandarin', 'Chinese'] },
  { name: 'Japanisch', aliases: ['Japanese'] },
  { name: 'Portugiesisch', aliases: ['Portuguese'] },
  { name: 'Polnisch', aliases: ['Polish'] },
  { name: 'Tschechisch', aliases: ['Czech'] },
  { name: 'Niederländisch', aliases: ['Holländisch', 'Dutch'] },
  { name: 'Hebräisch', aliases: ['Hebrew'] },
  { name: 'Ukrainisch', aliases: ['Ukrainian'] },
  { name: 'Koreanisch', aliases: ['Korean'] },
  { name: 'Biologie', aliases: ['Bio'], common: true },
  { name: 'Chemie', common: true },
  { name: 'Physik', common: true },
  { name: 'Informatik', aliases: ['Computer Science', 'IT'], common: true },
  { name: 'Natur und Technik', aliases: ['NuT', 'NWT', 'Naturwissenschaft und Technik'] },
  { name: 'Astronomie' },
  { name: 'Geologie' },
  { name: 'Geschichte', common: true },
  { name: 'Geografie', aliases: ['Geographie', 'Erdkunde'], common: true },
  { name: 'Politik und Gesellschaft', aliases: ['PuG', 'Sozialkunde', 'Politik', 'PGW'], common: true },
  { name: 'Sozialwissenschaften', aliases: ['Sowi', 'Sozialwissenschaft'] },
  { name: 'Wirtschaft und Recht', aliases: ['WiR', 'Wirtschaft-Recht'], common: true },
  { name: 'Wirtschaftslehre', aliases: ['Wirtschaft', 'Ökonomie', 'Oekonomie'] },
  { name: 'Betriebswirtschaftslehre', aliases: ['BWL'] },
  { name: 'Volkswirtschaftslehre', aliases: ['VWL'] },
  { name: 'Rechnungswesen', aliases: ['BWR', 'Buchführung', 'Buchfuehrung'] },
  { name: 'Rechtslehre', aliases: ['Recht'] },
  { name: 'Kunst', common: true },
  { name: 'Musik', common: true },
  { name: 'Theater', aliases: ['Darstellendes Spiel'] },
  { name: 'Sport', common: true },
  { name: 'Ethik', common: true },
  { name: 'Philosophie' },
  { name: 'Evangelische Religion', aliases: ['Evangelisch', 'Religion evangelisch'] },
  { name: 'Katholische Religion', aliases: ['Katholisch', 'Religion katholisch'] },
  { name: 'Islamische Religion', aliases: ['Islamunterricht', 'Islamisch'] },
  { name: 'Psychologie' },
  { name: 'Pädagogik', aliases: ['Paedagogik', 'Erziehungswissenschaften'] },
  { name: 'Gesundheit' },
  { name: 'Ernährung', aliases: ['Ernaehrung'] },
  { name: 'Soziale Arbeit', aliases: ['Sozialpädagogik', 'Sozialpaedagogik'] },
  { name: 'Technik' },
  { name: 'Ingenieurwissenschaften', aliases: ['Ingenieurwesen'] },
  { name: 'Elektrotechnik' },
  { name: 'Maschinenbau' },
  { name: 'Design' },
  { name: 'Medienkunde', aliases: ['Medien', 'Mediengestaltung'] },
  { name: 'Landwirtschaft', aliases: ['Agrarwirtschaft'] },
  { name: 'Hauswirtschaft' },
  { name: 'W-Seminar', aliases: ['Wissenschaftspropädeutisches Seminar'] },
  { name: 'P-Seminar', aliases: ['Projekt-Seminar'] },
] as const;

export function normalizeSubjectSearch(value: string): string {
  return value
    .normalize('NFD')
    .toLocaleLowerCase('de-DE')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function searchableValues(entry: SubjectCatalogEntry): string[] {
  return [entry.name, ...(entry.aliases ?? [])].map(normalizeSubjectSearch);
}

export function resolveCatalogSubjectName(query: string): string | null {
  const normalizedQuery = normalizeSubjectSearch(query);
  if (!normalizedQuery) return null;
  return subjectCatalog.find((entry) =>
    searchableValues(entry).some((value) => value === normalizedQuery))?.name ?? null;
}

export function searchSubjectCatalog(
  query: string,
  limit = 10,
): SubjectCatalogEntry[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  const normalizedQuery = normalizeSubjectSearch(query);
  if (!normalizedQuery) {
    return subjectCatalog.filter((entry) => entry.common).slice(0, safeLimit);
  }
  const terms = normalizedQuery.split(' ').filter(Boolean);
  return subjectCatalog
    .map((entry) => {
      const values = searchableValues(entry);
      if (!terms.every((term) => values.some((value) => value.includes(term)))) return null;
      const exact = values.some((value) => value === normalizedQuery);
      const startsWith = values.some((value) => value.startsWith(normalizedQuery));
      return { entry, score: exact ? 0 : startsWith ? 1 : 2 };
    })
    .filter((result): result is { entry: SubjectCatalogEntry; score: number } => result !== null)
    .sort((left, right) => left.score - right.score || left.entry.name.localeCompare(right.entry.name, 'de-DE'))
    .slice(0, safeLimit)
    .map((result) => result.entry);
}
