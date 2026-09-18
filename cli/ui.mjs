/**
 * Terminal presentation helpers: ASCII banner, colours, boxes and tables.
 *
 * Everything degrades to plain ASCII when colour is unavailable (`NO_COLOR`,
 * `--no-color`, or a non-TTY stdout such as a pipe into an agent), so the same
 * command is both pretty for humans and parseable for machines.
 */
import process from 'node:process';

const ESC = '\u001b[';

const forceColor = process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0';
const noColor =
  !!process.env.NO_COLOR || process.argv.includes('--no-color') || process.env.TERM === 'dumb';

export const colorEnabled = Boolean(forceColor) || (!noColor && process.stdout.isTTY === true);

const code =
  (open, close) =>
  (s) =>
    colorEnabled ? `${ESC}${open}m${s}${ESC}${close}m` : String(s);

export const c = {
  reset: (s) => String(s),
  bold: code(1, 22),
  dim: code(2, 22),
  italic: code(3, 23),
  underline: code(4, 24),
  red: code(31, 39),
  green: code(32, 39),
  yellow: code(33, 39),
  blue: code(34, 39),
  magenta: code(35, 39),
  cyan: code(36, 39),
  gray: code(90, 39),
  orange: (s) => (colorEnabled ? `${ESC}38;5;208m${s}${ESC}39m` : String(s)),
};

/** Zwep wordmark. Plain ASCII so it renders in cmd.exe, PowerShell and xterm alike. */
export const BANNER = String.raw`
 _____  __      __ ___   ___
|__  / \ \    / /| __| | _ \
  / /   \ \/\/ / | _|  |  _/
 /___/   \_/\_/  |___| |_|
`;

export function banner(subtitle = 'a small, self-hosted search engine') {
  const art = colorEnabled ? c.orange(BANNER) : BANNER;
  return `${art}${c.dim(`  ${subtitle}`)}\n`;
}

const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

/** Visible width of a string, ignoring ANSI escapes. */
export function width(s) {
  return String(s ?? '').replace(ANSI_RE, '').length;
}

export function pad(s, n, align = 'left') {
  const diff = Math.max(0, n - width(s));
  return align === 'right' ? ' '.repeat(diff) + s : s + ' '.repeat(diff);
}

/** Truncate to `n` visible characters, appending an ellipsis when cut. */
export function truncate(s, n) {
  const str = String(s ?? '');
  if (width(str) <= n) return str;
  return `${str.slice(0, Math.max(0, n - 1))}…`;
}

const BOX = { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', ml: '├', mr: '┤' };
const ASCII_BOX = { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', ml: '+', mr: '+' };

/** Unicode box drawing, unless the terminal is likely to mangle it. */
function glyphs() {
  const legacyWindows = process.platform === 'win32' && !process.env.WT_SESSION && !process.env.TERM;
  return legacyWindows ? ASCII_BOX : BOX;
}

export function box(title, lines, innerWidth = termWidth() - 4) {
  const g = glyphs();
  const w = Math.max(innerWidth, width(title) + 2);
  const top = `${g.tl}${g.h.repeat(w + 2)}${g.tr}`;
  const bottom = `${g.bl}${g.h.repeat(w + 2)}${g.br}`;
  const head = title
    ? [`${g.v} ${pad(c.bold(title), w)} ${g.v}`, `${g.ml}${g.h.repeat(w + 2)}${g.mr}`]
    : [];
  const body = lines.map((l) => `${g.v} ${pad(truncate(l, w), w)} ${g.v}`);
  return [top, ...head, ...body, bottom].join('\n');
}

export function termWidth() {
  return Math.max(40, Math.min(process.stdout.columns || 100, 120));
}

export function rule() {
  return c.dim(glyphs().h.repeat(Math.min(termWidth(), 100)));
}

/**
 * Render an array of objects as a fixed-width table.
 * `columns` is a list of `{ key, label, width?, align?, format? }`.
 */
export function table(rows, columns) {
  if (!rows.length) return c.dim('(nothing to show)');
  const cell = (col, row) => String(col.format ? col.format(row[col.key], row) : (row[col.key] ?? ''));
  const widths = columns.map(
    (col) => col.width ?? Math.max(width(col.label), ...rows.map((r) => width(cell(col, r)))),
  );
  const header = columns.map((col, i) => c.bold(pad(col.label, widths[i], col.align))).join('  ');
  const sep = c.dim(widths.map((w) => glyphs().h.repeat(w)).join('  '));
  const body = rows.map((r) =>
    columns.map((col, i) => pad(truncate(cell(col, r), widths[i]), widths[i], col.align)).join('  '),
  );
  return [header, sep, ...body].join('\n');
}

/** A 0..1 value as an ASCII meter, e.g. `████████░░  82`. */
export function meter(value, size = 10) {
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  const filled = Math.round(v * size);
  const bar = '█'.repeat(filled) + '░'.repeat(size - filled);
  const tint = v >= 0.7 ? c.green : v >= 0.45 ? c.yellow : c.red;
  return `${tint(bar)} ${pad(String(Math.round(v * 100)), 3, 'right')}`;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** A spinner that writes to stderr, so stdout stays clean for piping. */
export function spinner(text) {
  if (!process.stderr.isTTY) {
    process.stderr.write(`${text}\n`);
    return { update() {}, stop(final) {
      if (final) process.stderr.write(`${final}\n`);
    } };
  }
  let i = 0;
  let label = text;
  const timer = setInterval(() => {
    process.stderr.write(`\r${c.cyan(SPINNER[i++ % SPINNER.length])} ${label}${ESC}K`);
  }, 80);
  timer.unref?.();
  return {
    update(next) {
      label = next;
    },
    stop(final) {
      clearInterval(timer);
      process.stderr.write(`\r${ESC}K`);
      if (final) process.stderr.write(`${final}\n`);
    },
  };
}

export const symbols = {
  ok: colorEnabled ? c.green('✓') : '[ok]',
  err: colorEnabled ? c.red('✗') : '[!!]',
  warn: colorEnabled ? c.yellow('!') : '[ !]',
  info: colorEnabled ? c.cyan('›') : '[ i]',
  bullet: '•',
};
