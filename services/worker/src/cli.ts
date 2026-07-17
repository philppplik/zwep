/**
 * Zwep crawl worker CLI.
 *   node --experimental-strip-types services/worker/src/cli.ts crawl <source>
 */
import { loadSources } from '@zwep/config';
import { crawlSource } from './crawl-lib.ts';

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'crawl') {
    const name = process.argv[3];
    const max = process.argv[4] ? Number(process.argv[4]) : undefined;
    if (!name) {
      console.error('Usage: zwep crawl <source> [maxPages]');
      process.exit(1);
    }
    const summary = await crawlSource(name, max);
    console.log('Done.', {
      pages: summary.pages,
      skipped: summary.skipped,
      failed: summary.failed,
      indexed: summary.indexed,
      seconds: summary.seconds.toFixed(1),
    });
    process.exit(0);
  } else if (cmd === 'list') {
    console.log(loadSources().map((s) => `- ${s.name} (${s.allowedDomains.join(', ')})`).join('\n'));
    process.exit(0);
  } else {
    console.log('Usage:');
    console.log('  zwep crawl <source> [maxPages]');
    console.log('  zwep list');
    process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
