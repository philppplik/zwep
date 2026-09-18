/**
 * Command-line argument parsing.
 *
 * Lives in its own module so it can be tested without importing `bin/zwep.mjs`,
 * which would run the CLI as a side effect of the import.
 *
 * Supported forms:
 *   --key value      --key=value      --flag
 *   -abc             (expands to -a -b -c)
 *   --               (everything after is positional)
 */

/**
 * @param {string[]} argv Arguments after the node binary and script path.
 * @returns {{ flags: Record<string, string|true>, positional: string[] }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string|true>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      // A following token is this flag's value unless it is itself a flag.
      // Two tokens start with `-` but are still values: a lone `-` (the
      // conventional stdin placeholder) and a negative number.
      if (next !== undefined && (!next.startsWith('-') || next === '-' || /^-\d/.test(next))) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }

    // A negative number is a value, not a bundle of short flags.
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      for (const ch of a.slice(1)) flags[ch] = true;
      continue;
    }

    positional.push(a);
  }

  return { flags, positional };
}
