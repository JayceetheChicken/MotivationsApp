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
 *   1. every file is written to a temporary name *in its own target directory*,
 *      so the final step is a rename within one filesystem and cannot fail for
 *      lack of space or across a mount boundary,
 *   2. the previous contents are kept in memory,
 *   3. all temporary files are renamed onto their targets,
 *   4. if any rename fails, the already renamed files are restored from the
 *      in-memory copies and every temporary file is removed.
 *
 * A crash between two renames still leaves a mixed state - that cannot be
 * prevented without a transactional filesystem. Everything that a script can
 * control (validation failures, permission errors, a target that is a directory,
 * a read-only file) leaves the previous state untouched.
 */
const { mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, closeSync } = require('node:fs');
const path = require('node:path');

let temporaryCounter = 0;

/**
 * Previous content of a file, or null when it does not exist.
 * @param {string} file
 * @returns {Buffer | null}
 */
function readExisting(file) {
  let descriptor;
  try {
    descriptor = openSync(file, 'r');
    return readFileSync(descriptor);
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Already gone; nothing left to release.
      }
    }
  }
}

/** @param {readonly string[]} files */
function removeQuietly(files) {
  for (const file of files) {
    try {
      rmSync(file, { force: true });
    } catch {
      // A temporary file that cannot be removed is noise, not a failure: the
      // targets are already in a consistent state at this point.
    }
  }
}

/**
 * Writes every entry, or none of them.
 *
 * @param {readonly {path: string, content: string}[]} entries
 * @returns {{ written: string[] }}
 * @throws the original filesystem error, after restoring the previous state
 */
function writeFilesAtomically(entries) {
  const temporaries = [];
  const backups = [];

  try {
    for (const entry of entries) {
      mkdirSync(path.dirname(entry.path), { recursive: true });
      temporaryCounter += 1;
      const temporary = `${entry.path}.tmp-${process.pid}-${temporaryCounter}`;
      // `wx` fails instead of overwriting, so a leftover temporary from a
      // crashed run can never be mistaken for this run's output.
      writeFileSync(temporary, entry.content, { encoding: 'utf8', flag: 'wx' });
      temporaries.push(temporary);
      backups.push(readExisting(entry.path));
    }
  } catch (error) {
    removeQuietly(temporaries);
    throw error;
  }

  const renamed = [];
  try {
    for (let index = 0; index < entries.length; index += 1) {
      renameSync(temporaries[index], entries[index].path);
      renamed.push(index);
    }
  } catch (error) {
    for (const index of renamed) {
      const backup = backups[index];
      try {
        if (backup === null) rmSync(entries[index].path, { force: true });
        else writeFileSync(entries[index].path, backup);
      } catch {
        // Restoring failed as well. The thrown error below is what the caller
        // reports; swallowing here keeps the original cause visible.
      }
    }
    removeQuietly(temporaries);
    throw error;
  }

  return { written: entries.map((entry) => entry.path) };
}

module.exports = { readExisting, writeFilesAtomically };
