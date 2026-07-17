/** URL normalization + domain helpers used across crawl/extract. */

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Canonicalize for dedup: strip hash, sort query keys, drop trailing slash. */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./, '');
    // stable query order
    const params = [...u.searchParams.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
    );
    u.search = new URLSearchParams(params).toString();
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    u.pathname = path;
    return u.toString();
  } catch {
    return raw;
  }
}

/** Document id: "{source}_{sha1(canonical)}" (Meili ids: [a-zA-Z0-9_-] only). */
export function docId(source: string, _canonical: string, sha1: string): string {
  return `${source}_${sha1.slice(0, 12)}`;
}

export function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/** Resolve a possibly-relative link against a base URL; return null on junk. */
export function resolveUrl(link: string, base: string): string | null {
  try {
    return new URL(link, base).toString();
  } catch {
    return null;
  }
}

/** Keep only same-domain (allowed) links. */
export function filterAllowed(links: string[], allowed: Set<string>): string[] {
  const out: string[] = [];
  for (const l of links) {
    const h = hostnameOf(l);
    if (h && allowed.has(h)) out.push(l);
  }
  return [...new Set(out)];
}
