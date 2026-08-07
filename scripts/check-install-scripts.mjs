#!/usr/bin/env node
/**
 * Asserts which installed packages may run code during `npm install`.
 *
 *   node scripts/check-install-scripts.mjs
 *
 * `preinstall`, `install` and `postinstall` run automatically on every
 * developer machine and on every CI runner, with full user rights, before a
 * single test has executed. That is the shortest path a compromised dependency
 * has into this repository, so the set of packages allowed to use it is written
 * down and any addition fails the build.
 *
 * `prepare` and `prepublish` are deliberately not checked: npm runs them for the
 * root project and for git dependencies, never for a package installed from the
 * registry, so a `prepare` script in node_modules is inert.
 *
 * Adding an entry here is a decision, not a formality: state why the package
 * needs to run code at install time and what it does.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Packages that may run an install hook, with the reason.
 *
 * Every entry is a devDependency: nothing in the production dependency tree
 * runs code at install time, and that is the property worth keeping.
 */
const ALLOWED = new Map([
  [
    'unrs-resolver',
    'Devabhaengigkeit von eslint-import-resolver-typescript (ueber eslint-config-expo). '
    + 'Das postinstall-Skript waehlt das passende napi-Binary fuer die Plattform aus. '
    + 'Laeuft nie im Produktions-Dependency-Baum und nie in der App.',
  ],
]);

const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall'];

/** Every installed package that declares an install hook. */
function findInstallHooks(root) {
  /** @type {Map<string, {version: string, hooks: string[]}>} */
  const found = new Map();

  /** @param {string} directory */
  function walk(directory) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(directory, entry.name);
      // Scope directories (@scope/) hold packages one level deeper.
      if (entry.name.startsWith('@')) {
        walk(full);
        continue;
      }
      if (entry.name === '.bin') continue;

      try {
        const manifest = JSON.parse(readFileSync(path.join(full, 'package.json'), 'utf8'));
        const scripts = manifest.scripts ?? {};
        const hooks = INSTALL_HOOKS.filter((hook) => typeof scripts[hook] === 'string');
        if (hooks.length > 0) {
          found.set(manifest.name ?? entry.name, { version: manifest.version ?? '?', hooks });
        }
      } catch {
        // Not a package directory, or an unreadable manifest. Nested modules are
        // still walked below.
      }
      walk(path.join(full, 'node_modules'));
    }
  }

  walk(root);
  return found;
}

const found = findInstallHooks(path.join(projectRoot, 'node_modules'));
if (found.size === 0) {
  process.stderr.write(
    'In node_modules wurde kein einziges Paket gefunden. Wurde "npm ci" ausgefuehrt?\n',
  );
  process.exit(2);
}

const unexpected = [...found].filter(([name]) => !ALLOWED.has(name));
const missing = [...ALLOWED.keys()].filter((name) => !found.has(name));

for (const [name, { version, hooks }] of found) {
  if (ALLOWED.has(name)) process.stdout.write(`erlaubt: ${name}@${version} (${hooks.join(', ')})\n`);
}

if (unexpected.length > 0) {
  process.stderr.write('\nNicht freigegebene Install-Skripte in node_modules:\n');
  for (const [name, { version, hooks }] of unexpected) {
    process.stderr.write(`- ${name}@${version}: ${hooks.join(', ')}\n`);
  }
  process.stderr.write(
    '\nEin Install-Skript laeuft vor jedem Test mit vollen Benutzerrechten. Pruefe, was das Paket\n'
    + 'tut, und trage es erst danach mit Begruendung in scripts/check-install-scripts.mjs ein.\n',
  );
  process.exit(1);
}

if (missing.length > 0) {
  // Not a failure: a package may legitimately disappear. It is reported so the
  // allowlist does not quietly accumulate entries nobody can account for.
  process.stdout.write(
    `\nHinweis: ${missing.join(', ')} steht auf der Allowlist, ist aber nicht mehr installiert. `
    + 'Der Eintrag kann entfernt werden.\n',
  );
}

process.stdout.write(`\n${found.size} Paket(e) mit Install-Skript, alle freigegeben.\n`);
