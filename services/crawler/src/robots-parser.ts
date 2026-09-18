/**
 * Typed wrapper around `robots-parser`.
 *
 * The package ships a CommonJS build with an ESM `.d.ts`. Under
 * `module: NodeNext` TypeScript therefore resolves the default import to the
 * module namespace rather than the function, so every call site failed to
 * typecheck. Normalizing it once here keeps that quirk out of the crawler.
 */
import createRobots from 'robots-parser';

export interface RobotsRules {
  isAllowed(url: string, ua?: string): boolean | undefined;
  isDisallowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
  getSitemaps(): string[];
  getPreferredHost(): string | null;
}

type Factory = (url: string, robotsTxt: string) => RobotsRules;

const impl = createRobots as unknown as Factory & { default?: Factory };

/** Parse a robots.txt body into a rules object. */
export const robotsParser: Factory = (url, robotsTxt) =>
  (impl.default ?? impl)(url, robotsTxt);
