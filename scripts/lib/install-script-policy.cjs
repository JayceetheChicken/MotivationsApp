/**
 * Supply-chain policy for npm lifecycle scripts.
 *
 * `npm ci --ignore-scripts` must run before this module is used to rebuild the
 * small reviewed set below. The lockfile check itself does not read
 * node_modules, so it can also run in EAS' pre-install hook before dependency
 * code has had an opportunity to execute.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const INSTALL_HOOKS = Object.freeze(['preinstall', 'install', 'postinstall']);
const TRUSTED_REGISTRY_ORIGIN = 'https://registry.npmjs.org';

/**
 * Every field that can change what npm downloads or where a hook executes is
 * fixed here. Tarball integrity pins the reviewed lifecycle command together
 * with the rest of the package contents.
 */
const VETTED_INSTALL_SCRIPTS = Object.freeze([
  Object.freeze({
    lockPath: 'node_modules/fsevents',
    name: 'fsevents',
    version: '2.3.3',
    resolved: 'https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz',
    integrity: 'sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==',
    os: Object.freeze(['darwin']),
    cpu: Object.freeze([]),
    hooks: Object.freeze({ install: 'node-gyp rebuild' }),
    reason: 'Optionaler macOS-Dateisystem-Watcher; kompiliert sein natives Binary nur auf Darwin.',
  }),
  Object.freeze({
    lockPath: 'node_modules/unrs-resolver',
    name: 'unrs-resolver',
    version: '1.12.2',
    resolved: 'https://registry.npmjs.org/unrs-resolver/-/unrs-resolver-1.12.2.tgz',
    integrity: 'sha512-dmlRxBJJayXjqTwC+JtF1HhJmgf3ftQ3YejFcZrf4+KKtJv0qDsK1pjqaaVjG7wJ5NJ6UVP1OqRMQ71Z4C3rxQ==',
    os: Object.freeze([]),
    cpu: Object.freeze([]),
    hooks: Object.freeze({ postinstall: 'node postinstall.js' }),
    reason: 'Dev-Abhaengigkeit; waehlt das bereits integritaetsgepruefte napi-Binary aus.',
  }),
]);

function selectorArray(value, field, lockPath, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    errors.push(`${lockPath}: ${field} muss ein String-Array sein.`);
    return [];
  }
  return [...value];
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function packageNameFromLockPath(lockPath) {
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  return index === -1 ? null : lockPath.slice(index + marker.length);
}

function packageIdentity(entry) {
  return `${entry.name}@${entry.version}`;
}

function isSha512Integrity(value) {
  const match = typeof value === 'string' && value.match(/^sha512-([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return false;
  try {
    return Buffer.from(match[1], 'base64').length === 64;
  } catch {
    return false;
  }
}

function normalizedLocalTarget(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\\')) return null;
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.startsWith('node_modules/')
  ) return null;
  return normalized;
}

function validatePackageSources(packages, errors) {
  const localTargets = new Set();

  for (const [lockPath, value] of Object.entries(packages)) {
    if (!lockPath || !value || typeof value !== 'object' || value.link !== true) continue;
    if (!lockPath.includes('node_modules/')) {
      errors.push(`${lockPath}: lokaler Link steht nicht unter node_modules.`);
      continue;
    }
    const target = normalizedLocalTarget(value.resolved);
    if (!target) {
      errors.push(`${lockPath}: lokales Link-Ziel ist nicht eindeutig oder verlaesst das Repository.`);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(packages, target)) {
      errors.push(`${lockPath}: lokales Link-Ziel ${JSON.stringify(target)} fehlt im Lockfile.`);
      continue;
    }
    localTargets.add(target);
  }

  for (const [lockPath, value] of Object.entries(packages)) {
    if (!lockPath || !value || typeof value !== 'object' || value.link === true) continue;

    if (!lockPath.includes('node_modules/')) {
      if (!localTargets.has(lockPath)) {
        errors.push(`${lockPath}: unerwarteter lokaler Paket-Eintrag ohne expliziten node_modules-Link.`);
      }
      continue;
    }

    let resolvedUrl;
    try {
      resolvedUrl = new URL(value.resolved);
    } catch {
      errors.push(`${lockPath}: Registry-Paket hat keine gueltige resolved-URL.`);
    }
    if (
      resolvedUrl
      && (
        resolvedUrl.origin !== TRUSTED_REGISTRY_ORIGIN
        || resolvedUrl.username
        || resolvedUrl.password
        || resolvedUrl.search
        || resolvedUrl.hash
      )
    ) {
      errors.push(`${lockPath}: resolved muss auf ${TRUSTED_REGISTRY_ORIGIN} ohne Zugangsdaten oder Parameter zeigen.`);
    }
    if (!isSha512Integrity(value.integrity)) {
      errors.push(`${lockPath}: Registry-Paket braucht einen gueltigen SHA-512-Integrity-Hash.`);
    }
  }
}

/**
 * @param {unknown} lockfile
 * @param {readonly typeof VETTED_INSTALL_SCRIPTS[number][]} [policy]
 */
function validateLockfile(lockfile, policy = VETTED_INSTALL_SCRIPTS) {
  const errors = [];
  if (!lockfile || typeof lockfile !== 'object' || !lockfile.packages || typeof lockfile.packages !== 'object') {
    return { errors: ['package-lock.json enthaelt kein npm-packages-Objekt.'], entries: [] };
  }

  const policyByPath = new Map(policy.map((entry) => [entry.lockPath, entry]));
  const foundPaths = new Set();
  const entries = [];

  validatePackageSources(lockfile.packages, errors);

  for (const [lockPath, value] of Object.entries(lockfile.packages)) {
    if (!value || typeof value !== 'object' || value.hasInstallScript !== true) continue;

    const actual = {
      lockPath,
      name: packageNameFromLockPath(lockPath),
      version: value.version,
      resolved: value.resolved,
      integrity: value.integrity,
      os: selectorArray(value.os, 'os', lockPath, errors),
      cpu: selectorArray(value.cpu, 'cpu', lockPath, errors),
    };
    entries.push(actual);

    const expected = policyByPath.get(lockPath);
    if (!expected) {
      errors.push(`Nicht freigegebenes Install-Skript: ${actual.name ?? lockPath}@${actual.version ?? '?'}.`);
      continue;
    }
    foundPaths.add(lockPath);

    for (const field of ['name', 'version', 'resolved', 'integrity']) {
      if (actual[field] !== expected[field]) {
        errors.push(
          `${lockPath}: ${field} ist ${JSON.stringify(actual[field])}, erwartet ${JSON.stringify(expected[field])}.`,
        );
      }
    }
    if (!sameStrings(actual.os, expected.os)) {
      errors.push(`${lockPath}: os ist ${JSON.stringify(actual.os)}, erwartet ${JSON.stringify(expected.os)}.`);
    }
    if (!sameStrings(actual.cpu, expected.cpu)) {
      errors.push(`${lockPath}: cpu ist ${JSON.stringify(actual.cpu)}, erwartet ${JSON.stringify(expected.cpu)}.`);
    }
  }

  for (const expected of policy) {
    if (!foundPaths.has(expected.lockPath)) {
      errors.push(`Freigegebener Lockfile-Eintrag fehlt: ${expected.lockPath} (${packageIdentity(expected)}).`);
    }
  }

  return { errors, entries };
}

function selectorMatches(selectors, current) {
  const excluded = selectors
    .filter((selector) => selector.startsWith('!'))
    .map((selector) => selector.slice(1));
  if (excluded.includes(current)) return false;
  const included = selectors.filter((selector) => !selector.startsWith('!'));
  return included.length === 0 || included.includes(current);
}

function appliesToPlatform(entry, platform, arch) {
  return selectorMatches(entry.os, platform) && selectorMatches(entry.cpu, arch);
}

function lifecycleHooks(manifest) {
  const scripts = manifest && typeof manifest.scripts === 'object' ? manifest.scripts : {};
  return Object.fromEntries(
    INSTALL_HOOKS
      .filter((hook) => typeof scripts[hook] === 'string')
      .map((hook) => [hook, scripts[hook]]),
  );
}

function sameHooks(actual, expected) {
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
  return actualEntries.length === expectedEntries.length
    && actualEntries.every(([hook, command], index) => (
      hook === expectedEntries[index][0] && command === expectedEntries[index][1]
    ));
}

/**
 * Validates the extracted, not-yet-executed package manifests. npm has already
 * checked each tarball against the lockfile integrity at this point.
 */
function validateInstalledPackages(projectRoot, options = {}) {
  const policy = options.policy ?? VETTED_INSTALL_SCRIPTS;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const errors = [];
  const applicable = [];

  for (const expected of policy) {
    if (!appliesToPlatform(expected, platform, arch)) continue;
    const manifestPath = path.join(projectRoot, expected.lockPath, 'package.json');
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      errors.push(`${expected.lockPath}: package.json fehlt oder ist unlesbar (${error.message}).`);
      continue;
    }

    if (manifest.name !== expected.name || manifest.version !== expected.version) {
      errors.push(
        `${expected.lockPath}: installiert ist ${manifest.name ?? '?'}@${manifest.version ?? '?'}, `
        + `erwartet ${packageIdentity(expected)}.`,
      );
      continue;
    }
    const hooks = lifecycleHooks(manifest);
    if (!sameHooks(hooks, expected.hooks)) {
      errors.push(
        `${expected.lockPath}: Lifecycle-Skripte sind ${JSON.stringify(hooks)}, `
        + `erwartet ${JSON.stringify(expected.hooks)}.`,
      );
      continue;
    }
    applicable.push(expected);
  }

  return { errors, applicable };
}

function loadAndValidateLockfile(projectRoot, options = {}) {
  const lockfilePath = path.join(projectRoot, 'package-lock.json');
  let lockfile;
  try {
    lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  } catch (error) {
    return { errors: [`package-lock.json ist unlesbar (${error.message}).`], entries: [] };
  }
  return validateLockfile(lockfile, options.policy);
}

function validateNpmConfiguration(content) {
  let ignoreScripts;
  for (const sourceLine of content.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const match = line.match(/^ignore-scripts\s*=\s*(.*?)\s*$/i);
    if (match) ignoreScripts = match[1].toLowerCase();
  }
  return ignoreScripts === 'true'
    ? []
    : ['.npmrc muss ignore-scripts=true setzen; Lifecycle-Skripte duerfen nur ueber die gepruefte Rebuild-Policy laufen.'];
}

function validateProjectPolicy(projectRoot, options = {}) {
  const lockResult = loadAndValidateLockfile(projectRoot, options);
  let npmConfigurationErrors;
  try {
    npmConfigurationErrors = validateNpmConfiguration(readFileSync(path.join(projectRoot, '.npmrc'), 'utf8'));
  } catch (error) {
    npmConfigurationErrors = [`.npmrc ist unlesbar (${error.message}).`];
  }
  return {
    errors: [...npmConfigurationErrors, ...lockResult.errors],
    entries: lockResult.entries,
  };
}

function npmRebuildArguments(entry) {
  return Object.freeze([
    'rebuild',
    '--ignore-scripts=false',
    '--foreground-scripts',
    '--no-audit',
    '--no-fund',
    packageIdentity(entry),
  ]);
}

function npmRebuildInvocation(
  entry,
  platform = process.platform,
  windowsCommandShell = process.env.ComSpec || 'cmd.exe',
) {
  const rebuildArguments = npmRebuildArguments(entry);
  // Windows cannot execute a .cmd shim directly through spawnSync. Invoke the
  // OS command processor explicitly without `shell: true`; every argument after
  // npm.cmd still comes from the immutable, fully validated allowlist above.
  return platform === 'win32'
    ? {
      command: windowsCommandShell,
      args: ['/d', '/s', '/c', 'npm.cmd', ...rebuildArguments],
    }
    : { command: 'npm', args: rebuildArguments };
}

function rebuildVettedPackages(projectRoot, options = {}) {
  const lockResult = validateProjectPolicy(projectRoot, options);
  if (lockResult.errors.length > 0) return { errors: lockResult.errors, rebuilt: [] };

  const installedResult = validateInstalledPackages(projectRoot, options);
  if (installedResult.errors.length > 0) return { errors: installedResult.errors, rebuilt: [] };

  const platform = options.platform ?? process.platform;
  const run = options.spawnSync ?? spawnSync;
  const rebuilt = [];
  for (const entry of installedResult.applicable) {
    const invocation = npmRebuildInvocation(entry, platform);
    const result = run(invocation.command, invocation.args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        NPM_CONFIG_IGNORE_SCRIPTS: 'false',
        npm_config_ignore_scripts: 'false',
      },
      stdio: 'inherit',
    });
    if (result.error) {
      return { errors: [`${packageIdentity(entry)} konnte nicht gestartet werden: ${result.error.message}`], rebuilt };
    }
    if (result.status !== 0) {
      return { errors: [`${packageIdentity(entry)}: npm rebuild endete mit Exit ${result.status}.`], rebuilt };
    }
    rebuilt.push(entry);
  }

  return { errors: [], rebuilt };
}

module.exports = {
  INSTALL_HOOKS,
  TRUSTED_REGISTRY_ORIGIN,
  VETTED_INSTALL_SCRIPTS,
  appliesToPlatform,
  lifecycleHooks,
  loadAndValidateLockfile,
  npmRebuildArguments,
  npmRebuildInvocation,
  rebuildVettedPackages,
  validateInstalledPackages,
  validateLockfile,
  validateNpmConfiguration,
  validatePackageSources,
  validateProjectPolicy,
};
