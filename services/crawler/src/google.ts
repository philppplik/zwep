import { loadEnv } from '@zwep/config';

const env = loadEnv();

/**
 * Query Google and return the organic result URLs.
 *
 * This is intentionally fragile-by-design: Google serves different markup to
 * bots, may show a consent/interstitial, and rate-limits aggressively. We use
 * a real browser-like User-Agent, a modest concurrency, and return whatever
 * links we can parse. Callers must treat the result as best-effort.
 *
 * We do NOT render with Playwright here (Google is JS-heavy and will block
 * automated browsers) — we parse the static HTML, which still contains the
 * main result anchors in most datacenter responses.
 */
export async function googleSearchUrls(query: string, limit = 10): Promise<string[]> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${limit}&hl=en`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseGoogleResults(html).slice(0, limit);
  } catch {
    return [];
  }
}

function parseGoogleResults(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  // Primary: <a href="..."> whose href is a real http(s) link inside a
  // result container. Google wraps organic results in various tags; we grab
  // all external http(s) hrefs that are not google-owned.
  const re = /href="(https?:\/\/[^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const link = m[1];
    if (isGoogleOwned(link)) continue;
    if (seen.has(link)) continue;
    // skip obvious junk
    if (/\/(search|url|imgres|policies|preferences|intl\/)\b/.test(link)) continue;
    seen.add(link);
    out.push(link);
  }
  return out;
}

function isGoogleOwned(link: string): boolean {
  try {
    const h = new URL(link).hostname.replace(/^www\./, '');
    return h.endsWith('google.com') || h.endsWith('gstatic.com') || h.endsWith('googleusercontent.com');
  } catch {
    return false;
  }
}

/**
 * Build a list of seed URLs for a Google-type source by running all queries.
 */
export async function googleSeedUrls(queries: string[], perQuery = 8): Promise<string[]> {
  const all: string[] = [];
  for (const q of queries) {
    const urls = await googleSearchUrls(q, perQuery);
    all.push(...urls);
    // be polite between queries
    await new Promise((r) => setTimeout(r, env.CRAWLER_DELAY_MS));
  }
  return [...new Set(all)];
}
