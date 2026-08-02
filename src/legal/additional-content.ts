import type { LegalSection } from '@/legal/privacy-content';

export const legalDraftNotice = 'Entwurfsfassung – vor Veröffentlichung rechtlich prüfen. Angaben in eckigen Klammern müssen durch echte Betreiberangaben ersetzt werden.';

export const termsSections: readonly LegalSection[] = [
  {
    title: '1. Anbieter und Geltung',
    paragraphs: [
      'Lernzeit wird angeboten von [NAME/FIRMA], [ANSCHRIFT], [KONTAKT]. Diese Bedingungen gelten für Gastmodus, Online-Konto, Synchronisierung und freiwillige Social-Funktionen.',
    ],
  },
  {
    title: '2. Konto und Sicherheit',
    paragraphs: [
      'Nutzer müssen richtige Kontaktdaten verwenden, Zugangsdaten geheim halten und einen vermuteten Missbrauch unverzüglich an [SUPPORT-KONTAKT] melden. Konten dürfen nicht zur Täuschung, Umgehung von Sperren oder Beeinträchtigung anderer verwendet werden.',
    ],
  },
  {
    title: '3. Eigene Inhalte',
    paragraphs: [
      'Wer Profilbilder, Namen, Gruppen, gemeinsame Ziele oder Sessions teilt, muss hierzu berechtigt sein und die Community-Regeln beachten. Rechte an eigenen Inhalten verbleiben grundsätzlich beim Nutzer; für die technische Bereitstellung wird dem Betreiber die dafür erforderliche, zweckgebundene Nutzung gestattet.',
    ],
  },
  {
    title: '4. Moderation und Sperren',
    paragraphs: [
      'Inhalte können gemeldet, geprüft, ausgeblendet oder entfernt werden. Konten können bei erheblichen oder wiederholten Verstößen eingeschränkt werden. Entscheidungen sollen dokumentiert und unter [BESCHWERDEKONTAKT] überprüfbar sein.',
    ],
  },
  {
    title: '5. Verfügbarkeit, Haftung und Änderungen',
    paragraphs: [
      'Es besteht kein Anspruch auf unterbrechungsfreie Verfügbarkeit. Gesetzlich zwingende Haftung bleibt unberührt. Haftungsumfang, anwendbares Recht, Verbraucherhinweise und Änderungsverfahren sind vor Release rechtlich festzulegen: [ANGABEN ERGÄNZEN].',
    ],
  },
];
export const communitySections: readonly LegalSection[] = [
  {
    title: 'Respekt und Sicherheit',
    bullets: [
      'Keine Belästigung, Drohung, Hassrede, sexualisierte Ansprache oder Verherrlichung von Gewalt.',
      'Keine Veröffentlichung personenbezogener Daten anderer ohne wirksame Berechtigung.',
      'Keine Nachahmung anderer Personen, Täuschung oder Umgehung von Blockierungen.',
    ],
  },
  {
    title: 'Inhalte und Rechte',
    bullets: [
      'Nur Bilder, Namen und Texte teilen, an denen die nötigen Rechte bestehen.',
      'Keine Schadsoftware, Werbung, Spam oder manipulative Einladungen.',
      'Lernbezogene Gruppen, Ziele und Sessions dürfen keine rechtswidrigen Inhalte enthalten.',
    ],
  },
  {
    title: 'Melden, Blockieren und Moderation',
    paragraphs: [
      'Profile und gemeinsame Inhalte können direkt in Lernzeit gemeldet werden. Blockierungen sind für die blockierte Person nicht sichtbar und verhindern Suche, neue Freundschaftsanfragen, direkte Einladungen sowie Presence-Freigaben. Bestehende gemeinsame Gruppen bleiben bestehen, bis ein Mitglied sie regulär verlässt oder ein Betreiber eingreift.',
      'Meldungen werden mit minimalen Metadaten bearbeitet. Missbräuchliche Serienmeldungen können rate-limitiert werden. Moderationsstatus: open, reviewing, resolved oder rejected.',
    ],
  },
  {
    title: 'Version und Zustimmung',
    paragraphs: [
      'Version: 2026-08-02. Die Zustimmung erfolgt nicht vorangekreuzt und wird mit Version und Zeitpunkt gespeichert. Wesentliche Änderungen erfordern eine neue ausdrückliche Zustimmung.',
    ],
  },
];

export const imprintSections: readonly LegalSection[] = [
  {
    title: 'Anbieterkennzeichnung',
    paragraphs: [
      '[VOLLSTÄNDIGER NAME/FIRMA]',
      '[RECHTSFORM, VERTRETUNGSBERECHTIGTE PERSON]',
      '[LADUNGSFÄHIGE ANSCHRIFT]',
      'E-Mail: [KONTAKT-E-MAIL], Telefon: [FALLS ERFORDERLICH]',
    ],
  },
  {
    title: 'Register, Aufsicht und Umsatzsteuer',
    paragraphs: [
      '[REGISTER UND REGISTERNUMMER ODER „NICHT EINGETRAGEN“ NACH PRÜFUNG]',
      '[ZUSTÄNDIGE AUFSICHTSBEHÖRDE, FALLS EINSCHLÄGIG]',
      '[UMSATZSTEUER-ID ODER RECHTLICH ZULÄSSIGE NICHTANGABE]',
    ],
  },
  {
    title: 'Verbraucherstreitbeilegung',
    paragraphs: [
      '[ERFORDERLICHE INFORMATION ZUR VERBRAUCHERSTREITBEILEGUNG NACH RECHTLICHER PRÜFUNG EINFÜGEN].',
    ],
  },
];
