#!/usr/bin/env node --experimental-strip-types
/**
 * Seed 50+ curated sources into Zwep via the admin API.
 * Run: ADMIN_KEY=zwep_admin_dev_key API=http://localhost:8090 node seed-sources.ts
 */
const ADMIN_KEY = process.env.ADMIN_KEY || 'zwep_admin_dev_key';
const API = process.env.API || 'http://localhost:8080';

interface Seed {
  name: string;
  domain: string;
  homepage: string;
  sitemap?: string;
  maxPages?: number;
}

// 50+ high-quality curated sources (German + international, diverse topics)
const SEEDS: Seed[] = [
  // ---- German reference & knowledge ----
  { name: 'Wikipedia DE', domain: 'de.wikipedia.org', homepage: 'https://de.wikipedia.org', sitemap: 'https://de.wikipedia.org/sitemap.xml', maxPages: 200 },
  { name: 'Wikipedia EN', domain: 'en.wikipedia.org', homepage: 'https://en.wikipedia.org', sitemap: 'https://en.wikipedia.org/sitemap.xml', maxPages: 200 },
  { name: 'Wiktionary DE', domain: 'de.wiktionary.org', homepage: 'https://de.wiktionary.org', maxPages: 80 },
  { name: 'Wikibooks DE', domain: 'de.wikibooks.org', homepage: 'https://de.wikibooks.org', maxPages: 50 },
  { name: 'Wikiquote DE', domain: 'de.wikiquote.org', homepage: 'https://de.wikiquote.org', maxPages: 40 },
  { name: 'Wikisource DE', domain: 'de.wikisource.org', homepage: 'https://de.wikisource.org', maxPages: 40 },
  { name: 'Wikivoyage DE', domain: 'de.wikivoyage.org', homepage: 'https://de.wikivoyage.org', maxPages: 60 },

  // ---- German government & public ----
  { name: 'Bundesregierung', domain: 'bundesregierung.de', homepage: 'https://www.bundesregierung.de', sitemap: 'https://www.bundesregierung.de/sitemap.xml', maxPages: 60 },
  { name: 'BMI', domain: 'bmi.bund.de', homepage: 'https://www.bmi.bund.de', maxPages: 50 },
  { name: 'BMAS', domain: 'bmas.de', homepage: 'https://www.bmas.de', maxPages: 50 },
  { name: 'BMWi', domain: 'bmwk.de', homepage: 'https://www.bmwk.de', maxPages: 50 },
  { name: 'BMF', domain: 'bundesfinanzministerium.de', homepage: 'https://www.bundesfinanzministerium.de', maxPages: 50 },
  { name: 'BMG', domain: 'bmg.bund.de', homepage: 'https://www.bmg.bund.de', maxPages: 50 },
  { name: 'BMBF', domain: 'bmbf.de', homepage: 'https://www.bmbf.de', maxPages: 50 },
  { name: 'Destatis', domain: 'destatis.de', homepage: 'https://www.destatis.de', sitemap: 'https://www.destatis.de/sitemap.xml', maxPages: 80 },
  { name: 'Gesetze im Internet', domain: 'gesetze-im-internet.de', homepage: 'https://www.gesetze-im-internet.de', maxPages: 100 },
  { name: 'Deutsche Welle', domain: 'dw.com', homepage: 'https://www.dw.com', sitemap: 'https://www.dw.com/sitemap.xml', maxPages: 80 },

  // ---- German news & media ----
  { name: 'Tagesschau', domain: 'tagesschau.de', homepage: 'https://www.tagesschau.de', maxPages: 60 },
  { name: 'ZDF', domain: 'zdf.de', homepage: 'https://www.zdf.de', maxPages: 60 },
  { name: 'ARD', domain: 'ard.de', homepage: 'https://www.ard.de', maxPages: 50 },
  { name: 'Spiegel', domain: 'spiegel.de', homepage: 'https://www.spiegel.de', sitemap: 'https://www.spiegel.de/sitemap.xml', maxPages: 100 },
  { name: 'Zeit', domain: 'zeit.de', homepage: 'https://www.zeit.de', sitemap: 'https://www.zeit.de/sitemap.xml', maxPages: 100 },
  { name: 'FAZ', domain: 'faz.net', homepage: 'https://www.faz.net', maxPages: 80 },
  { name: 'Sueddeutsche', domain: 'sueddeutsche.de', homepage: 'https://www.sueddeutsche.de', maxPages: 80 },
  { name: 'Welt', domain: 'welt.de', homepage: 'https://www.welt.de', maxPages: 80 },
  { name: 'Taz', domain: 'taz.de', homepage: 'https://www.taz.de', maxPages: 60 },
  { name: 'Heise', domain: 'heise.de', homepage: 'https://www.heise.de', sitemap: 'https://www.heise.de/sitemap.xml', maxPages: 100 },
  { name: 'Golem', domain: 'golem.de', homepage: 'https://www.golem.de', sitemap: 'https://www.golem.de/sitemap.xml', maxPages: 80 },
  { name: 'Netzpolitik', domain: 'netzpolitik.org', homepage: 'https://netzpolitik.org', sitemap: 'https://netzpolitik.org/sitemap.xml', maxPages: 60 },

  // ---- German science & education ----
  { name: 'Spektrum', domain: 'spektrum.de', homepage: 'https://www.spektrum.de', maxPages: 60 },
  { name: 'Scinexx', domain: 'scinexx.de', homepage: 'https://www.scinexx.de', maxPages: 60 },
  { name: 'Telekolleg', domain: 'br.de', homepage: 'https://www.br.de', maxPages: 50 },
  { name: 'Chemie DE', domain: 'chemie.de', homepage: 'https://www.chemie.de', maxPages: 50 },
  { name: 'Mpg', domain: 'mpg.de', homepage: 'https://www.mpg.de', sitemap: 'https://www.mpg.de/sitemap.xml', maxPages: 80 },
  { name: 'Fraunhofer', domain: 'fraunhofer.de', homepage: 'https://www.fraunhofer.de', maxPages: 60 },
  { name: 'Dfg', domain: 'dfg.de', homepage: 'https://www.dfg.de', maxPages: 50 },

  // ---- German culture & society ----
  { name: 'Deutschlandfunk', domain: 'deutschlandfunk.de', homepage: 'https://www.deutschlandfunk.de', maxPages: 70 },
  { name: 'Goethe', domain: 'goethe.de', homepage: 'https://www.goethe.de', maxPages: 50 },
  { name: 'ZEIT Wissen', domain: 'zeit.de', homepage: 'https://www.zeit.de/wissen/index', maxPages: 40 },
  { name: 'Planet Wissen', domain: 'planet-wissen.de', homepage: 'https://www.planet-wissen.de', maxPages: 50 },
  { name: 'Bpb', domain: 'bpb.de', homepage: 'https://www.bpb.de', maxPages: 70 },

  // ---- International knowledge & reference ----
  { name: 'Wiki EN Books', domain: 'en.wikibooks.org', homepage: 'https://en.wikibooks.org', maxPages: 40 },
  { name: 'Wiki Quote EN', domain: 'en.wikiquote.org', homepage: 'https://en.wikiquote.org', maxPages: 40 },
  { name: 'Encyclopaedia Britannica', domain: 'britannica.com', homepage: 'https://www.britannica.com', maxPages: 80 },
  { name: 'Stanford Encyclopedia', domain: 'plato.stanford.edu', homepage: 'https://plato.stanford.edu', maxPages: 60 },

  // ---- International tech & science ----
  { name: 'MIT', domain: 'mit.edu', homepage: 'https://www.mit.edu', maxPages: 60 },
  { name: 'Harvard', domain: 'harvard.edu', homepage: 'https://www.harvard.edu', maxPages: 50 },
  { name: 'Arxiv', domain: 'arxiv.org', homepage: 'https://arxiv.org', sitemap: 'https://arxiv.org/sitemap.xml', maxPages: 100 },
  { name: 'Nature', domain: 'nature.com', homepage: 'https://www.nature.com', maxPages: 80 },
  { name: 'Science Mag', domain: 'science.org', homepage: 'https://www.science.org', maxPages: 60 },
  { name: 'NIH', domain: 'nih.gov', homepage: 'https://www.nih.gov', maxPages: 60 },
  { name: 'NASA', domain: 'nasa.gov', homepage: 'https://www.nasa.gov', sitemap: 'https://www.nasa.gov/sitemap.xml', maxPages: 80 },
  { name: 'MDN', domain: 'developer.mozilla.org', homepage: 'https://developer.mozilla.org', sitemap: 'https://developer.mozilla.org/sitemaps/sitemap.xml', maxPages: 100 },
  { name: 'Stack Overflow', domain: 'stackoverflow.com', homepage: 'https://stackoverflow.com', maxPages: 60 },
  { name: 'GitHub Docs', domain: 'docs.github.com', homepage: 'https://docs.github.com', maxPages: 60 },
  { name: 'OpenAI', domain: 'openai.com', homepage: 'https://openai.com', maxPages: 40 },
  { name: 'Hugging Face', domain: 'huggingface.co', homepage: 'https://huggingface.co', maxPages: 50 },

  // ---- International news ----
  { name: 'BBC', domain: 'bbc.com', homepage: 'https://www.bbc.com', sitemap: 'https://www.bbc.com/sitemaps/index.xml', maxPages: 80 },
  { name: 'The Guardian', domain: 'theguardian.com', homepage: 'https://www.theguardian.com', sitemap: 'https://www.theguardian.com/sitemap', maxPages: 80 },
  { name: 'NYT', domain: 'nytimes.com', homepage: 'https://www.nytimes.com', maxPages: 60 },
  { name: 'Reuters', domain: 'reuters.com', homepage: 'https://www.reuters.com', maxPages: 60 },
  { name: 'AP', domain: 'apnews.com', homepage: 'https://apnews.com', maxPages: 60 },

  // ---- International reference & society ----
  { name: 'TED', domain: 'ted.com', homepage: 'https://www.ted.com', maxPages: 50 },
  { name: 'Khan Academy', domain: 'khanacademy.org', homepage: 'https://www.khanacademy.org', maxPages: 60 },
  { name: 'Coursera', domain: 'coursera.org', homepage: 'https://www.coursera.org', maxPages: 50 },
  { name: 'Internet Archive', domain: 'archive.org', homepage: 'https://archive.org', maxPages: 50 },
  { name: 'Project Gutenberg', domain: 'gutenberg.org', homepage: 'https://www.gutenberg.org', maxPages: 50 },
  { name: 'WHO', domain: 'who.int', homepage: 'https://www.who.int', maxPages: 60 },
  { name: 'UN', domain: 'un.org', homepage: 'https://www.un.org', maxPages: 60 },
  { name: '欧盟 EU', domain: 'europa.eu', homepage: 'https://europa.eu', maxPages: 60 },
];

async function seed() {
  let ok = 0;
  let fail = 0;
  for (const s of SEEDS) {
    const payload = {
      name: s.name,
      type: 'web' as const,
      seeds: [s.homepage],
      allowedDomains: [s.domain],
      sitemap: s.sitemap,
      maxPages: s.maxPages ?? 50,
      enabled: true,
    };
    try {
      const res = await fetch(`${API}/v1/admin/sources?admin_key=${ADMIN_KEY}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        ok++;
        console.log(`✓ ${s.name}`);
      } else {
        fail++;
        const b = await res.json().catch(() => ({}));
        console.error(`✗ ${s.name}: ${b?.error?.message || res.status}`);
      }
    } catch (e) {
      fail++;
      console.error(`✗ ${s.name}: ${(e as Error).message}`);
    }
  }
  console.log(`\nDone. ${ok} sources added, ${fail} failed.`);
}

seed();
