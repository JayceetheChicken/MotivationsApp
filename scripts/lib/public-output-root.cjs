const path = require('node:path');

/**
 * The destination is always public/. An environment-selectable alternative is
 * a production-gate bypass: the gate could validate generated fixtures while
 * the actual files packaged by Expo remain stale.
 */
function resolvePublicOutputRoot(projectRoot, environment = process.env) {
  const configured = environment.LERNZEIT_PUBLIC_OUTPUT_DIR;
  if (!configured) return path.join(projectRoot, 'public');
  throw new Error(
    'LERNZEIT_PUBLIC_OUTPUT_DIR ist nicht erlaubt; Release-Seiten werden ausschliesslich unter public/ erzeugt und geprueft.',
  );
}

module.exports = { resolvePublicOutputRoot };
