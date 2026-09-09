/**
 * Filename rules for files that must never be tracked in git.
 *
 * CommonJS so the rules can be exercised directly by the Jest suite
 * (__tests__/release-scripts.test.ts) instead of only through the CLI.
 *
 * Every rule is fully anchored and matched against the *basename* only.
 * The previous single rule
 *
 *     /service[-_]?account|firebase-adminsdk|credentials.*\.json$/i
 *
 * was reported by CodeQL (js/regex/missing-regexp-anchor): alternation binds
 * weaker than the anchor, so only the last branch required a `.json` suffix.
 * `docs/service-account-explanation.md` matched, and because the expression was
 * also applied to path segments elsewhere a directory called
 * `some-service-account-folder/` was enough to fail the check.
 */

/** @type {readonly {name: string, pattern: RegExp, description: string}[]} */
const SENSITIVE_FILENAME_RULES = [
  {
    name: 'codex-attachment',
    pattern: /^\.codex-remote-attachments$/,
    description: 'Verzeichnis mit hochgeladenen Anhängen.',
  },
  {
    name: 'dotenv',
    // .env, .env.local, .env.production - but not the committed template.
    pattern: /^\.env(?:\.(?!example$)[^.]+)*$/i,
    description: 'Umgebungsdatei mit echten Werten.',
  },
  {
    name: 'key-material',
    pattern: /^[^/\\]*\.(?:jks|keystore|p12|pfx|pem|key|p8|der|crt|cer)$/i,
    description: 'Signatur- oder Schlüsselmaterial.',
  },
  {
    name: 'mobile-service-config',
    pattern: /^(?:google-services\.json|GoogleService-Info\.plist)$/i,
    description: 'Mobile Service-Konfiguration mit Projektschlüsseln.',
  },
  {
    name: 'service-account',
    pattern: /^[^/\\]*service[-_]?account[^/\\]*\.json$/i,
    description: 'Google-Service-Account-Schlüsseldatei.',
  },
  {
    name: 'firebase-adminsdk',
    pattern: /^[^/\\]*firebase-adminsdk[^/\\]*\.json$/i,
    description: 'Firebase-Admin-SDK-Schlüsseldatei.',
  },
  {
    name: 'credentials-json',
    pattern: /^[^/\\]*credentials[^/\\]*\.json$/i,
    description: 'Zugangsdaten im JSON-Format.',
  },
  {
    name: 'database-dump',
    pattern: /^[^/\\]*\.(?:sqlite3?|db|dump|bak|sql\.gz)$/i,
    description: 'Datenbank-Abzug mit potenziellen Personendaten.',
  },
];

/**
 * The rule that forbids this path, or null when the path is fine.
 *
 * Only the basename is inspected, except for the attachment directory, which is
 * matched against the leading path segment. A directory whose *name* merely
 * resembles a secret ("some-service-account-folder/readme.md") is never a
 * finding; the file inside it has to be sensitive on its own.
 *
 * @param {string} trackedPath repository-relative path as reported by git
 * @returns {{name: string, description: string} | null}
 */
function classifyTrackedPath(trackedPath) {
  const normalized = String(trackedPath ?? '').replaceAll('\\', '/');
  if (!normalized) return null;

  const segments = normalized.split('/');
  const basename = segments.at(-1) ?? '';

  for (const rule of SENSITIVE_FILENAME_RULES) {
    const subject = rule.name === 'codex-attachment' ? segments[0] : basename;
    if (rule.pattern.test(subject)) {
      return { name: rule.name, description: rule.description };
    }
  }
  return null;
}

/**
 * @param {readonly string[]} trackedPaths
 * @returns {{path: string, rule: string, description: string}[]}
 */
function findSensitiveTrackedPaths(trackedPaths) {
  const findings = [];
  for (const trackedPath of trackedPaths) {
    const rule = classifyTrackedPath(trackedPath);
    if (rule) findings.push({ path: trackedPath, rule: rule.name, description: rule.description });
  }
  return findings;
}

module.exports = {
  SENSITIVE_FILENAME_RULES,
  classifyTrackedPath,
  findSensitiveTrackedPaths,
};
