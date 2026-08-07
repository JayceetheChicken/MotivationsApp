/**
 * All-or-nothing writing of a set of generated files.
 *
 * The two operator-hosted artefacts belong together: `assetlinks.json` declares
 * which app may claim the domain, and `account-deletion/index.html` is what a
 * Play reviewer and a user actually open. Publishing a new deletion page next to
 * a stale assetlinks.json - or the reverse - is a state nobody reviews and
 * nobody notices, so this module refuses to produce it.
 *
 * Sequence:
 *   1. every entry is validated - non-empty distinct paths, string content -
 *      before a single byte is written,
 *   2. every file is written to a temporary name *in its own target directory*,
 *      so the final step is a rename within one filesystem and cannot fail for
 *      lack of space or across a mount boundary,
 *   3. the previous contents are read into memory; a read that fails for any
 *      reason other than "the file does not exist" aborts here, before the
 *      first rename,
 *   4. all temporary files are renamed onto their targets,
 *   5. if any rename fails, the already renamed files are restored from the
 *      in-memory copies and every temporary file is removed.
 *
 * ## What this module will not claim
 *
 * A crash between two renames still leaves a mixed state - that cannot be
 * prevented without a transactional filesystem. And if step 5 itself fails, the
 * previous state is *not* restored. Reporting "nothing was changed" in that case
 * would be a lie that sends the operator away from a half-published domain
 * configuration, so the error carries the list of files that may already differ
 * and the caller is expected to print it.
 */
// Called through the module object rather than destructured bindings. The
// rollback path can only be exercised by making one specific restore fail, and
// a destructured `writeFileSync` cannot be replaced from a test - which would
// leave the one branch that must never lie about the previous state untested.
const fs = require('node:fs');
const path = require('node:path');

let temporaryCounter = 0;

/**
 * Raised when the write failed *and* the rollback did not fully succeed.
 *
 * The distinction matters to the operator: an ordinary failure means "try
 * again, nothing happened", while this one means "look at these files before
 * you do anything else".
 */
class AtomicWriteRollbackError extends Error {
  /**
   * @param {Error} originalFailure the error that stopped the write
   * @param {Error[]} rollbackFailures every restore that also failed
   * @param {string[]} possiblyChangedPaths targets that may already differ
   * @param {string[]} temporaryPaths temporary files, if any survived
   */
  constructor(originalFailure, rollbackFailures, possiblyChangedPaths, temporaryPaths) {
    super(
      `Der Schreibvorgang und mindestens ein Rollback sind fehlgeschlagen. `
      + `Die folgenden Dateien koennen bereits veraendert sein: ${possiblyChangedPaths.join(', ')}. `
      + `Urspruenglicher Fehler: ${originalFailure?.message ?? originalFailure}. `
      + `Rollback-Fehler: ${rollbackFailures.map((error) => error?.message ?? error).join(' | ')}.`,
    );
    this.name = 'AtomicWriteRollbackError';
    this.originalFailure = originalFailure;
    this.rollbackFailures = rollbackFailures;
    this.possiblyChangedPaths = possiblyChangedPaths;
    this.temporaryPaths = temporaryPaths;
  }
}

/**
 * Previous content of a file, or null when it does not exist.
 *
 * Only ENOENT means "not there". A permission error, a directory in the way or
 * an I/O fault used to be swallowed into the same `null`, which told the caller
 * "there is nothing to restore" - and a rollback would then have *deleted* a
 * file it simply could not read. Everything except ENOENT therefore throws, and
 * it throws before any target has been touched.
 *
 * @param {string} file
 * @returns {Buffer | null}
 * @throws every filesystem error other than ENOENT
 */
function readExisting(file) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, 'r');
    return fs.readFileSync(descriptor);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Already gone; nothing left to release.
      }
    }
  }
}

/**
 * Removes every temporary file and reports the ones that survived.
 * @param {readonly string[]} files
 * @returns {string[]} the paths that could not be removed
 */
function removeQuietly(files) {
  const remaining = [];
  for (const file of files) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // Reported rather than thrown: a leftover temporary is not a reason to
      // hide the failure that produced it, but the operator should see it.
      remaining.push(file);
    }
  }
  return remaining;
}

/**
 * Rejects an entry list that cannot be written atomically, before anything is
 * written.
 *
 * Two targets that resolve to the same path would make the second rename
 * silently overwrite the first, and the backup taken for the second would be
 * the first one's *new* content - so a rollback would restore the wrong bytes.
 *
 * @param {readonly {path: string, content: string}[]} entries
 */
function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('writeFilesAtomically wurde ohne zu schreibende Dateien aufgerufen.');
  }

  const seen = new Map();
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Eintrag ${index} ist kein Objekt mit path und content.`);
    }
    if (typeof entry.path !== 'string' || entry.path.trim() === '') {
      throw new Error(`Eintrag ${index} hat keinen nutzbaren Zielpfad: ${JSON.stringify(entry.path)}.`);
    }
    if (typeof entry.content !== 'string') {
      throw new Error(`Eintrag "${entry.path}" hat keinen Textinhalt (${typeof entry.content}).`);
    }
    const resolved = path.resolve(entry.path);
    if (seen.has(resolved)) {
      throw new Error(
        `Der Zielpfad "${resolved}" kommt mehrfach vor (Eintraege ${seen.get(resolved)} und ${index}). `
        + 'Zwei Eintraege auf dieselbe Datei koennen nicht atomar geschrieben werden.',
      );
    }
    seen.set(resolved, index);
  }
}

/**
 * Writes every entry, or none of them.
 *
 * @param {readonly {path: string, content: string}[]} entries
 * @returns {{ written: string[] }}
 * @throws {AtomicWriteRollbackError} when the write *and* a rollback failed;
 *   the previous state is then not guaranteed
 * @throws the original filesystem error when the previous state was restored
 */
function writeFilesAtomically(entries) {
  validateEntries(entries);

  const temporaries = [];
  const backups = [];

  try {
    for (const entry of entries) {
      fs.mkdirSync(path.dirname(entry.path), { recursive: true });
      temporaryCounter += 1;
      const temporary = `${entry.path}.tmp-${process.pid}-${temporaryCounter}`;
      // `wx` fails instead of overwriting, so a leftover temporary from a
      // crashed run can never be mistaken for this run's output.
      fs.writeFileSync(temporary, entry.content, { encoding: 'utf8', flag: 'wx' });
      temporaries.push(temporary);
      // Throws on anything but "file does not exist" - deliberately here, while
      // no target has been replaced yet.
      backups.push(readExisting(entry.path));
    }
  } catch (error) {
    removeQuietly(temporaries);
    throw error;
  }

  const renamed = [];
  try {
    for (let index = 0; index < entries.length; index += 1) {
      fs.renameSync(temporaries[index], entries[index].path);
      renamed.push(index);
    }
  } catch (error) {
    const rollbackFailures = [];
    const possiblyChangedPaths = [];
    for (const index of renamed) {
      const backup = backups[index];
      try {
        if (backup === null) fs.rmSync(entries[index].path, { force: true });
        else fs.writeFileSync(entries[index].path, backup);
      } catch (rollbackError) {
        // Never swallowed. A failed restore means the caller must not tell the
        // operator that the previous state survived.
        rollbackFailures.push(rollbackError);
        possiblyChangedPaths.push(entries[index].path);
      }
    }
    const remainingTemporaries = removeQuietly(temporaries);
    if (rollbackFailures.length > 0) {
      throw new AtomicWriteRollbackError(
        error,
        rollbackFailures,
        possiblyChangedPaths,
        remainingTemporaries,
      );
    }
    throw error;
  }

  // Every temporary was renamed away, so this is normally a no-op. It runs
  // anyway - `fs.rmSync({force: true})` ignores a missing file - so success has the
  // same "no temporary survives" guarantee as failure.
  removeQuietly(temporaries);
  return { written: entries.map((entry) => entry.path) };
}

module.exports = { AtomicWriteRollbackError, readExisting, validateEntries, writeFilesAtomically };
