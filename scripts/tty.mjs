/**
 * Terminal colour for the repository's own scripts.
 *
 * Built from a character code rather than an escape sequence on purpose: a raw
 * ESC byte in a source file survives most editors but not every tool that
 * rewrites it, and this module has been silently corrupted that way before.
 *
 * Colour switches itself off when stdout is not a terminal, or when NO_COLOR is
 * set, so piped output stays clean.
 */
import process from 'node:process';

const ESC = `${String.fromCharCode(27)}[`;

export const colorEnabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const wrap = (open, close) => (s) => (colorEnabled ? `${ESC}${open}m${s}${ESC}${close}m` : `${s}`);

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
};

/** Status glyphs that degrade to ASCII where colour is unavailable. */
export const mark = {
  ok: colorEnabled ? c.green('✓') : '[ok]',
  warn: colorEnabled ? c.yellow('!') : '[!]',
  fail: colorEnabled ? c.red('✗') : '[x]',
  arrow: colorEnabled ? c.dim('→') : '->',
};
