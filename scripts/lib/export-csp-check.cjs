const { createHash } = require('node:crypto');

function decodeHtmlAttribute(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);/g, (_match, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function parseAttributes(tag) {
  const attributes = new Map();
  const pattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes.set(
      match[1].toLowerCase(),
      decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? ''),
    );
  }
  return attributes;
}

function parseHeaderRules(content) {
  const rules = [];
  let current = null;
  for (const sourceLine of content.split(/\r?\n/)) {
    if (!sourceLine.trim() || sourceLine.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(sourceLine)) {
      current = { pattern: sourceLine.trim(), headers: new Map() };
      rules.push(current);
      continue;
    }
    const separator = sourceLine.indexOf(':');
    if (!current || separator === -1) continue;
    current.headers.set(
      sourceLine.slice(0, separator).trim().toLowerCase(),
      sourceLine.slice(separator + 1).trim(),
    );
  }
  return rules;
}

function routeForExportFile(file) {
  const normalized = `/${file.replaceAll('\\', '/')}`;
  if (normalized === '/index.html') return '/';
  return normalized.endsWith('/index.html')
    ? normalized.slice(0, -'index.html'.length)
    : normalized;
}

function ruleMatches(pattern, route) {
  if (pattern.endsWith('*')) return route.startsWith(pattern.slice(0, -1));
  return route === pattern;
}

function responsePolicyFor(rules, route) {
  return rules
    .filter((rule) => ruleMatches(rule.pattern, route))
    .sort((left, right) => right.pattern.replace(/\*$/, '').length - left.pattern.replace(/\*$/, '').length)
    .map((rule) => rule.headers.get('content-security-policy'))
    .find(Boolean) ?? null;
}

function metaPolicies(html) {
  const policies = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    if (attributes.get('http-equiv')?.toLowerCase() !== 'content-security-policy') continue;
    const content = attributes.get('content');
    if (content) policies.push(content);
  }
  return policies;
}

function isHtmlTagBoundary(character) {
  return character === undefined || /[\t\n\f\r />]/.test(character);
}

function tagEnd(html, start) {
  let quote = null;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

/**
 * Finds the raw-text end tag using HTML tag-name boundaries rather than a
 * filtering regexp. Browsers terminate a script at malformed spellings such as
 * `</script\t data-extra>` too; overlooking those bytes would let an executable
 * inline script escape the CSP hash inventory.
 */
function scriptEnd(html, lowerHtml, start) {
  let cursor = start;
  for (;;) {
    const candidate = lowerHtml.indexOf('</script', cursor);
    // An unclosed script consumes the remaining document as raw text. Inventory
    // those bytes too instead of silently treating malformed HTML as scriptless.
    if (candidate === -1) return { contentEnd: html.length, tagEnd: html.length };
    const afterName = candidate + '</script'.length;
    if (!isHtmlTagBoundary(lowerHtml[afterName])) {
      cursor = afterName;
      continue;
    }
    const end = html.indexOf('>', afterName);
    return end === -1 ? { contentEnd: candidate, tagEnd: html.length } : {
      contentEnd: candidate,
      tagEnd: end + 1,
    };
  }
}

function executableInlineScripts(html) {
  const scripts = [];
  const lowerHtml = html.toLowerCase();
  let cursor = 0;
  while (cursor < html.length) {
    const markup = html.indexOf('<', cursor);
    if (markup === -1) break;
    if (lowerHtml.startsWith('<!--', markup)) {
      const commentEnd = lowerHtml.indexOf('-->', markup + 4);
      cursor = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }
    if (
      !lowerHtml.startsWith('<script', markup)
      || !isHtmlTagBoundary(lowerHtml[markup + '<script'.length])
    ) {
      cursor = markup + 1;
      continue;
    }

    const openingEnd = tagEnd(html, markup + '<script'.length);
    if (openingEnd === -1) break;
    const attributes = parseAttributes(html.slice(markup, openingEnd + 1));
    const end = scriptEnd(html, lowerHtml, openingEnd + 1);
    if (!end) break;
    const type = attributes.get('type')?.trim().toLowerCase();
    if (
      !attributes.has('src')
      && (!type || ['text/javascript', 'application/javascript', 'module'].includes(type))
    ) {
      scripts.push(html.slice(openingEnd + 1, end.contentEnd));
    }
    cursor = end.tagEnd;
  }
  return scripts;
}

function scriptDirective(policy) {
  const directives = new Map();
  for (const sourceDirective of policy.split(';')) {
    const parts = sourceDirective.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 0) directives.set(parts[0].toLowerCase(), parts.slice(1));
  }
  return directives.get('script-src') ?? directives.get('default-src') ?? [];
}

function inlineHash(script) {
  return `sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}`;
}

function collectExportCspIssues(documents) {
  const issues = [];
  const headersDocument = documents.find(({ file }) => file.replaceAll('\\', '/') === '_headers');
  if (!headersDocument) return ['Im Export fehlt die aus public/_headers kopierte Response-Header-Policy.'];
  const rules = parseHeaderRules(headersDocument.content);

  for (const document of documents.filter(({ file }) => file.toLowerCase().endsWith('.html'))) {
    const route = routeForExportFile(document.file);
    const responsePolicy = responsePolicyFor(rules, route);
    const metas = metaPolicies(document.content);
    if (!responsePolicy) {
      issues.push(`${document.file}: keine passende Content-Security-Policy in _headers.`);
      continue;
    }
    if (metas.length === 0) {
      issues.push(`${document.file}: keine CSP-Meta-Fallback-Policy.`);
      continue;
    }

    const policies = [responsePolicy, ...metas];
    for (const policy of policies) {
      if (scriptDirective(policy).includes("'unsafe-inline'")) {
        issues.push(`${document.file}: script-src darf unsafe-inline nicht freigeben.`);
      }
    }
    for (const script of executableInlineScripts(document.content)) {
      const hash = inlineHash(script);
      for (const policy of policies) {
        const sources = scriptDirective(policy);
        if (!sources.includes(`'${hash}'`)) {
          issues.push(`${document.file}: Inline-Skript ${hash} fehlt in einer wirksamen CSP.`);
        }
      }
    }
  }
  return [...new Set(issues)];
}

module.exports = {
  collectExportCspIssues,
  decodeHtmlAttribute,
  executableInlineScripts,
  inlineHash,
  metaPolicies,
  parseHeaderRules,
  responsePolicyFor,
  routeForExportFile,
  scriptDirective,
};
