/**
 * Is a host usable as a *public* operator domain?
 *
 * One implementation, deliberately CommonJS and dependency free, because the
 * identical code has to run in the app bundle (Hermes), in app.config.js, in the
 * release gate, in the public page generator and in the export scanner. A second
 * implementation is how a host ends up accepted in one place and rejected in
 * another.
 *
 * "Public" here means: reachable from the open internet by a third party. A
 * loopback, link-local, private or reserved address is not, and neither is a
 * reserved test domain. Shipping such a host would produce a legal page nobody
 * can open, an Android App Link that can never be verified, and a password
 * recovery mail pointing at an address that resolves differently on every
 * device.
 *
 * The address ranges below are checked numerically, never with a string prefix:
 * `startsWith('172.16.')` would miss 172.20.0.1 and wrongly accept 172.160.0.1.
 */

/**
 * Reserved top level domains. RFC 2606 (invalid/test/example), RFC 6761
 * (localhost) and RFC 6762 (local, mDNS). None of them can be delegated, so a
 * host under them never resolves publicly.
 */
const RESERVED_TLDS = new Set(['invalid', 'test', 'example', 'localhost', 'local']);

/**
 * RFC 2606 reserved second level names. They exist in the public DNS but are
 * documentation placeholders, never an operator's own domain.
 */
const RESERVED_REGISTRABLE_DOMAINS = new Set(['example.com', 'example.net', 'example.org']);

/** Characters that must never reach the URL parser as part of a bare host. */
const UNSAFE_HOST_CHARACTERS = /[\s/\\@?#%]/;

/** A single DNS label: letters, digits and inner hyphens, at most 63 octets. */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * A public top level domain is alphabetic, or an A-label (punycode) such as
 * `xn--p1ai`. It is never all digits - that shape only occurs in a malformed
 * IPv4 literal.
 */
const PUBLIC_TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

/**
 * @typedef {'dns' | 'ipv4' | 'ipv6' | 'invalid'} HostKind
 * @typedef {{ public: boolean, kind: HostKind, normalized: string, reason: string }} HostClassification
 */

/** @returns {HostClassification} */
function verdict(isPublic, kind, normalized, reason) {
  return { public: isPublic, kind, normalized, reason };
}

/**
 * Normalises a bare host to lower case ASCII.
 *
 * Deliberately does *not* route the value through `new URL`. The URL parser
 * canonicalises hosts differently in different runtimes - Node performs IDNA
 * and rewrites every legal IPv4 spelling, the React Native URL polyfill does
 * neither - and a host that classifies as public in CI but private in the app
 * would defeat the whole point of having one shared check. Everything below is
 * therefore parsed here, with the same result in Node, in CI and in Hermes.
 *
 * A non-ASCII host is refused rather than converted: the operator has to
 * configure the punycode (`xn--…`) form, which is unambiguous everywhere.
 *
 * @param {string} value
 * @returns {string | null}
 */
function canonicalHost(value) {
  const candidate = String(value ?? '').trim().replace(/\.$/, '');
  if (!candidate || candidate.length > 253) return null;
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(candidate)) return null;
  if (UNSAFE_HOST_CHARACTERS.test(candidate)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f]/.test(candidate)) return null;
  return candidate.toLowerCase();
}

/**
 * @param {string} host canonical host
 * @returns {number[] | null} four octets, or null when the host is not IPv4
 */
function parseIpv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

/**
 * @param {string} host canonical host, IPv6 literals still in brackets
 * @returns {number[] | null} eight 16-bit groups, or null when the host is not IPv6
 */
function parseIpv6(host) {
  if (!host.startsWith('[') || !host.endsWith(']')) return null;
  let text = host.slice(1, -1);
  if (!text) return null;

  // A trailing dotted quad (::ffff:192.0.2.1) becomes two 16-bit groups.
  const embedded = text.match(/(?:^|:)((?:[0-9]{1,3}\.){3}[0-9]{1,3})$/);
  if (embedded) {
    const octets = parseIpv4(embedded[1]);
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, text.length - embedded[1].length)}${high}:${low}`;
  }

  const doubleColon = text.split('::');
  if (doubleColon.length > 2) return null;

  /** @param {string} part */
  const groupsOf = (part) => {
    if (part === '') return [];
    const groups = [];
    for (const piece of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      groups.push(Number.parseInt(piece, 16));
    }
    return groups;
  };

  const head = groupsOf(doubleColon[0]);
  if (head === null) return null;
  if (doubleColon.length === 1) return head.length === 8 ? head : null;

  const tail = groupsOf(doubleColon[1]);
  if (tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

/**
 * Non-public IPv4 space. Every range is compared numerically on the 32-bit
 * value, so no boundary can be missed.
 * @param {readonly number[]} octets
 * @returns {string | null} the reason, or null when the address is public
 */
function ipv4Reason(octets) {
  const [a, b] = octets;

  if (a === 0) return '0.0.0.0/8 ist „diese Netzwerk“-Adressraum und niemals öffentlich erreichbar.';
  if (a === 10) return '10.0.0.0/8 ist ein privates Netz (RFC 1918).';
  if (a === 127) return '127.0.0.0/8 ist Loopback.';
  if (a === 100 && b >= 64 && b <= 127) return '100.64.0.0/10 ist Carrier-Grade-NAT (RFC 6598).';
  if (a === 169 && b === 254) return '169.254.0.0/16 ist Link-Local.';
  if (a === 172 && b >= 16 && b <= 31) return '172.16.0.0/12 ist ein privates Netz (RFC 1918).';
  if (a === 192 && b === 168) return '192.168.0.0/16 ist ein privates Netz (RFC 1918).';
  if (a === 192 && b === 0 && octets[2] === 2) return '192.0.2.0/24 ist für Dokumentation reserviert.';
  if (a === 198 && (b === 18 || b === 19)) return '198.18.0.0/15 ist für Benchmarks reserviert.';
  if (a === 198 && b === 51 && octets[2] === 100) return '198.51.100.0/24 ist für Dokumentation reserviert.';
  if (a === 203 && b === 0 && octets[2] === 113) return '203.0.113.0/24 ist für Dokumentation reserviert.';
  if (a >= 224 && a <= 239) return '224.0.0.0/4 ist Multicast und kein Host.';
  if (a >= 240) return '240.0.0.0/4 ist reserviert, 255.255.255.255 ist Broadcast.';
  return null;
}

/**
 * Non-public IPv6 space.
 * @param {readonly number[]} groups eight 16-bit groups
 * @returns {string | null}
 */
function ipv6Reason(groups) {
  const isZero = groups.every((group) => group === 0);
  if (isZero) return ':: ist die unspezifizierte Adresse.';
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return '::1 ist Loopback.';

  // IPv4-mapped (::ffff:a.b.c.d) reaches the IPv4 stack, and the URL parser has
  // already rewritten the dotted quad to two hex groups. Classify the embedded
  // address instead of treating ::ffff:7f00:1 as an unrelated IPv6 host.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const embedded = ipv4Reason([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff]);
    return embedded ? `IPv4-mapped: ${embedded}` : null;
  }

  if ((groups[0] & 0xffc0) === 0xfe80) return 'fe80::/10 ist Link-Local.';
  if ((groups[0] & 0xfe00) === 0xfc00) return 'fc00::/7 ist Unique-Local.';
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return '2001:db8::/32 ist für Dokumentation reserviert.';
  if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) {
    return '100::/64 ist der Discard-Only-Präfix.';
  }
  return null;
}

/**
 * Classifies any host string.
 *
 * `public: true` only means "publicly routable / publicly resolvable". Whether a
 * host may additionally serve as the operator domain is decided by
 * {@link isPublicOperatorHost}, which also rules out bare IP literals.
 *
 * @param {string} value
 * @returns {HostClassification}
 */
function classifyPublicHost(value) {
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(String(value ?? ''))) {
    return verdict(
      false,
      'invalid',
      '',
      'Internationalisierte Hosts müssen als Punycode („xn--…“) konfiguriert werden, '
      + 'weil die Umwandlung sonst je nach Laufzeitumgebung unterschiedlich ausfällt.',
    );
  }

  const host = canonicalHost(value);
  if (!host) return verdict(false, 'invalid', '', 'Kein syntaktisch gültiger Host.');

  const ipv6 = parseIpv6(host);
  if (ipv6) {
    const reason = ipv6Reason(ipv6);
    return reason
      ? verdict(false, 'ipv6', host, reason)
      : verdict(true, 'ipv6', host, 'Öffentliche IPv6-Adresse.');
  }
  if (host.startsWith('[')) return verdict(false, 'invalid', host, 'Kein gültiges IPv6-Literal.');

  const ipv4 = parseIpv4(host);
  if (ipv4) {
    const reason = ipv4Reason(ipv4);
    return reason
      ? verdict(false, 'ipv4', host, reason)
      : verdict(true, 'ipv4', host, 'Öffentliche IPv4-Adresse.');
  }

  const labels = host.split('.');
  if (labels.length < 2) {
    return verdict(false, 'dns', host, `„${host}“ ist ein Single-Label-Host ohne öffentliche Domain.`);
  }
  if (labels.some((label) => !DNS_LABEL.test(label))) {
    return verdict(false, 'dns', host, 'Mindestens ein DNS-Label ist ungültig.');
  }

  const tld = labels[labels.length - 1];
  if (RESERVED_TLDS.has(tld)) {
    return verdict(false, 'dns', host, `Die Top-Level-Domain „.${tld}“ ist reserviert und wird nie delegiert.`);
  }
  if (!PUBLIC_TLD.test(tld)) {
    return verdict(false, 'dns', host, `„.${tld}“ ist keine gültige öffentliche Top-Level-Domain.`);
  }
  if (RESERVED_REGISTRABLE_DOMAINS.has(labels.slice(-2).join('.'))) {
    return verdict(false, 'dns', host, `„${labels.slice(-2).join('.')}“ ist eine reservierte Beispieldomain (RFC 2606).`);
  }

  return verdict(true, 'dns', host, 'Öffentlicher DNS-Host.');
}

/**
 * May this host be the operator's public domain?
 *
 * Additionally rules out bare IP literals: Android verifies an App Link against
 * a host name, and a TLS certificate for the published legal pages is issued for
 * a domain, not for an address.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isPublicOperatorHost(value) {
  const classification = classifyPublicHost(value);
  return classification.public && classification.kind === 'dns';
}

/**
 * The reason a host may not be used, or null when it may.
 * @param {string} value
 * @returns {string | null}
 */
function publicOperatorHostIssue(value) {
  const classification = classifyPublicHost(value);
  if (classification.public && classification.kind === 'dns') return null;
  if (classification.public) {
    return `„${classification.normalized}“ ist eine IP-Adresse. Für verifizierte Android App Links und ein `
      + 'TLS-Zertifikat der öffentlichen Rechtsseiten wird ein echter Domainname benötigt.';
  }
  return classification.reason;
}

module.exports = {
  RESERVED_TLDS,
  RESERVED_REGISTRABLE_DOMAINS,
  canonicalHost,
  parseIpv4,
  parseIpv6,
  classifyPublicHost,
  isPublicOperatorHost,
  publicOperatorHostIssue,
};
