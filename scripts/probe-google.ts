// Quick probe: does googleSearchUrls return results from this environment?
import { googleSearchUrls } from '../services/crawler/src/google.ts';

const q = process.argv[2] || 'Meilisearch tutorial';
const urls = await googleSearchUrls(q, 8);
console.log(`Query: ${q}`);
console.log(`Results: ${urls.length}`);
for (const u of urls.slice(0, 8)) console.log('  -', u);
