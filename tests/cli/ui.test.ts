import { describe, expect, it } from 'vitest';
import { BANNER, banner, box, c, meter, pad, table, truncate, width } from '../../cli/ui.mjs';

describe('banner', () => {
  it('is pure ASCII so every terminal can render it', () => {
    // cmd.exe in its default code page mangles anything outside ASCII.
    expect(/^[\x20-\x7e\n\\/|_]*$/.test(BANNER)).toBe(true);
  });

  it('includes the subtitle', () => {
    expect(banner('hello world')).toContain('hello world');
  });
});

describe('width', () => {
  it('ignores ANSI escape sequences', () => {
    expect(width('abc')).toBe(3);
    expect(width('[32mabc[39m')).toBe(3);
  });

  it('treats null and undefined as empty', () => {
    expect(width(null)).toBe(0);
    expect(width(undefined)).toBe(0);
  });
});

describe('pad', () => {
  it('pads to a visible width, left and right', () => {
    expect(pad('ab', 5)).toBe('ab   ');
    expect(pad('ab', 5, 'right')).toBe('   ab');
  });

  it('never truncates when the string is already wider', () => {
    expect(pad('abcdef', 3)).toBe('abcdef');
  });
});

describe('truncate', () => {
  it('appends an ellipsis when it cuts', () => {
    expect(truncate('abcdefgh', 4)).toBe('abc…');
  });

  it('leaves a short string alone', () => {
    expect(truncate('abc', 10)).toBe('abc');
  });

  it('handles nullish input', () => {
    expect(truncate(undefined, 5)).toBe('');
  });
});

describe('table', () => {
  it('aligns columns to their widest cell', () => {
    const out = table(
      [
        { name: 'alpha', n: 1 },
        { name: 'a-much-longer-name', n: 22 },
      ],
      [
        { key: 'name', label: 'Name' },
        { key: 'n', label: 'N', align: 'right' },
      ],
    );
    const lines = out.split('\n');
    expect(lines).toHaveLength(4); // header, separator, two rows
    expect(lines[0]).toContain('Name');
    expect(width(lines[2])).toBe(width(lines[3]));
  });

  it('applies a formatter', () => {
    const out = table(
      [{ on: false }],
      [{ key: 'on', label: 'Active', format: (v: unknown) => (v ? 'yes' : 'no') }],
    );
    expect(out).toContain('no');
  });

  it('renders a placeholder for an empty set', () => {
    expect(table([], [{ key: 'a', label: 'A' }])).toContain('nothing to show');
  });

  it('substitutes an empty string for a missing key', () => {
    expect(() => table([{}], [{ key: 'missing', label: 'M' }])).not.toThrow();
  });
});

describe('meter', () => {
  it('scales the bar and prints the percentage', () => {
    expect(meter(1, 10)).toContain('██████████');
    expect(meter(1, 10)).toContain('100');
    expect(meter(0, 10)).toContain('░░░░░░░░░░');
  });

  it('clamps out-of-range and non-numeric values', () => {
    expect(meter(5, 4)).toContain('████');
    expect(meter(-1, 4)).toContain('░░░░');
    expect(meter('nonsense', 4)).toContain('░░░░');
  });
});

describe('box', () => {
  it('draws a titled frame whose lines all share one width', () => {
    const lines = box('Title', ['one', 'two'], 20).split('\n');
    const widths = new Set(lines.map(width));
    expect(widths.size).toBe(1);
    expect(lines[1]).toContain('Title');
  });
});

describe('colour helpers', () => {
  it('return plain strings when colour is disabled in this environment', () => {
    // Tests run without a TTY, so `colorEnabled` is false and output is clean
    // for piping into an agent.
    expect(c.green('x')).toBe('x');
    expect(c.bold('x')).toBe('x');
  });
});
