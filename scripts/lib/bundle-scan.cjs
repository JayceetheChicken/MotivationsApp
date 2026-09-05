/**
 * Secret detection for built artefacts.
 *
 * CommonJS so __tests__/release-scripts.test.ts can run the exact scanner the
 * CLI runs, including the embedded-JWT decoding.
 */
const {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
} = require('node:fs');
const path = require('node:path');

const releaseConfig = require('../../config/release-config.cjs');

const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.json', '.html', '.css', '.map', '.txt', '.webmanifest',
]);
const MAX_SCANNED_BYTES = 32 * 1024 * 1024;

/**
 * Literal shapes that are secrets regardless of encoding. The service-role
 * entry only catches an *unencoded* leak (a JSON fixture, a source map with the
 * original object). A real Supabase key never looks like this, which is why
 * `scanTextForSecrets` additionally decodes every JWT candidate below.
 */
const SECRET_PATTERNS = [
  { name: 'Supabase service-role JWT im Klartext', pattern: /"role"\s*:\s*"service_role"/ },
  { name: 'Supabase service-role Bezeichner', pattern: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']{8,}/ },
  { name: 'Supabase Secret-Key', pattern: /\bsb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: 'Privater Schluessel im PEM-Format', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'Google-Service-Account-Key', pattern: /"type"\s*:\s*"service_account"/ },
  { name: 'Google-Service-Account-Feld', pattern: /"private_key_id"\s*:\s*"[A-Za-z0-9]{8,}"/ },
  { name: 'AWS Access Key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub-Token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'Expo-Access-Token', pattern: /\bexp_[A-Za-z0-9]{24,}\b/ },
  { name: 'Postgres-Verbindungsstring mit Passwort', pattern: /postgres(?:ql)?:\/\/[^\s:'"]+:[^\s@'"]+@/ },
];

/**
 * Every secret finding in one text.
 *
 * Two independent passes:
 *   1. the literal patterns above,
 *   2. every JWT-shaped candidate, decoded with the central decoder. A token
 *      is only reported once its payload really decodes to a JSON object, and
 *      it is accepted only when its role is exactly "anon". `service_role`,
 *      any other role and a missing role are all rejected.
 *
 * @param {string} content
 * @returns {{name: string, detail: string}[]}
 */
function scanTextForSecrets(content) {
  const findings = [];

  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) findings.push({ name, detail: `Muster ${pattern}` });
  }

  for (const candidate of releaseConfig.findJwtCandidates(content)) {
    const verdict = releaseConfig.classifyEmbeddedJwt(candidate);
    if (!verdict.isJwt || verdict.allowed) continue;
    findings.push({
      name: 'Unerlaubter eingebetteter JWT',
      // Never echo the token itself; the role and a short prefix are enough to
      // locate it without copying a live credential into a CI log.
      detail: `${verdict.reason} (Token beginnt mit „${candidate.slice(0, 12)}…“)`,
    });
  }

  return findings;
}

/**
 * Reads a file through exactly one descriptor, so the bytes that are inspected
 * are provably the bytes whose metadata was checked.
 *
 * Checking a path before opening it is a time-of-check/time-of-use race
 * (CodeQL js/file-system-race): between the two calls the path can be replaced.
 * Open first, then compare the descriptor with the path metadata. All bytes are
 * read from that one descriptor, so a later rename cannot change what is
 * inspected. O_NOFOLLOW rejects symlinks where the platform supports it; the
 * post-open lstat check provides the same fail-closed result elsewhere.
 *
 * A file that is too large to inspect is a failure, not a skip: reporting
 * "no secrets found" for bytes that were never read would be a lie.
 *
 * @param {string} file
 * @param {number} [maxBytes]
 * @returns {{ ok: true, content: string } | { ok: false, reason: string }}
 */
function readTextFileOnce(file, maxBytes = MAX_SCANNED_BYTES) {
  let descriptor;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stats = fstatSync(descriptor, { bigint: true });
    if (!stats.isFile()) {
      return { ok: false, reason: 'Kein regulaeres File mehr (waehrend des Scans ersetzt?).' };
    }
    const pathStats = lstatSync(file, { bigint: true });
    if (pathStats.isSymbolicLink()) {
      return { ok: false, reason: 'Symbolische Links werden im Export nicht akzeptiert.' };
    }
    if (!pathStats.isFile()) {
      return { ok: false, reason: 'Kein regulaeres File im Export.' };
    }
    if (stats.dev !== pathStats.dev || stats.ino !== pathStats.ino) {
      return { ok: false, reason: 'File wurde waehrend des Scans ersetzt.' };
    }
    if (stats.size > maxBytes) {
      return {
        ok: false,
        reason: `${stats.size} Bytes uebersteigen das Scan-Limit von ${maxBytes} Bytes.`,
      };
    }
    return { ok: true, content: readFileSync(descriptor, 'utf8') };
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) };
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The descriptor is already gone; nothing left to release.
      }
    }
  }
}

function* walk(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    yield { file: directory, reason: error?.message ?? String(error) };
    return;
  }

  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield { file: full };
    else {
      yield {
        file: full,
        reason: entry.isSymbolicLink()
          ? 'Symbolische Links werden im Export nicht akzeptiert.'
          : 'Nicht unterstuetzter Dateityp im Export.',
      };
    }
  }
}

/**
 * Scans a built export directory.
 *
 * A file that cannot be read is reported in `unreadable` and never silently
 * treated as clean - the CLI turns any such entry into a failed scan.
 *
 * @param {string} root
 * @param {{ maxBytes?: number }} [options]
 * @returns {{
 *   scanned: number,
 *   skipped: number,
 *   findings: {file: string, name: string, detail: string}[],
 *   unreadable: {file: string, reason: string}[],
 *   documents: {file: string, content: string}[],
 * }}
 */
function scanExportDirectory(root, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_SCANNED_BYTES;
  let scanned = 0;
  let skipped = 0;
  const findings = [];
  const unreadable = [];
  /** Every inspected file with its content, so later checks can name the file. */
  const documents = [];

  for (const walked of walk(root)) {
    const { file } = walked;
    if (walked.reason) {
      unreadable.push({ file: path.relative(root, file), reason: walked.reason });
      continue;
    }
    if (
      !TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())
      && path.basename(file) !== '_headers'
    ) {
      skipped += 1;
      continue;
    }

    const result = readTextFileOnce(file, maxBytes);
    if (!result.ok) {
      unreadable.push({ file: path.relative(root, file), reason: result.reason });
      continue;
    }

    scanned += 1;
    documents.push({ file: path.relative(root, file), content: result.content });
    for (const finding of scanTextForSecrets(result.content)) {
      findings.push({ file: path.relative(root, file), ...finding });
    }
  }

  return { scanned, skipped, findings, unreadable, documents };
}

module.exports = {
  MAX_SCANNED_BYTES,
  SECRET_PATTERNS,
  TEXT_EXTENSIONS,
  readTextFileOnce,
  scanExportDirectory,
  scanTextForSecrets,
};
