/**
 * The CLI's version, read from its own package.json.
 *
 * Hardcoding it in each module meant a release had to remember every copy —
 * and 0.3.0 nearly shipped with the MCP server still announcing 0.2.0.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const VERSION = (() => {
  try {
    const pkg = fileURLToPath(new URL('../package.json', import.meta.url));
    return JSON.parse(readFileSync(pkg, 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
