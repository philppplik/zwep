import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../cli/args.mjs';

describe('parseArgs', () => {
  it('collects positional arguments in order', () => {
    expect(parseArgs(['search', 'climate', 'policy']).positional).toEqual([
      'search',
      'climate',
      'policy',
    ]);
  });

  it('reads --key value', () => {
    expect(parseArgs(['--limit', '20']).flags).toEqual({ limit: '20' });
  });

  it('reads --key=value', () => {
    expect(parseArgs(['--api=http://x:1']).flags).toEqual({ api: 'http://x:1' });
  });

  it('keeps an = inside the value intact', () => {
    expect(parseArgs(['--q=a=b']).flags).toEqual({ q: 'a=b' });
  });

  it('treats a bare --flag as true', () => {
    expect(parseArgs(['--json']).flags).toEqual({ json: true });
  });

  it('does not swallow the next flag as a value', () => {
    expect(parseArgs(['--json', '--limit', '5']).flags).toEqual({ json: true, limit: '5' });
  });

  it('expands bundled short flags', () => {
    expect(parseArgs(['-vh']).flags).toEqual({ v: true, h: true });
  });

  it('treats a negative number as a value, not a flag bundle', () => {
    expect(parseArgs(['--offset', '-5']).flags).toEqual({ offset: '-5' });
  });

  it('stops parsing flags after --', () => {
    const { flags, positional } = parseArgs(['search', '--', '--not-a-flag', 'x']);
    expect(flags).toEqual({});
    expect(positional).toEqual(['search', '--not-a-flag', 'x']);
  });

  it('mixes flags and positionals in any order', () => {
    const { flags, positional } = parseArgs(['search', '--limit', '5', 'climate', '--json']);
    expect(flags).toEqual({ limit: '5', json: true });
    expect(positional).toEqual(['search', 'climate']);
  });

  it('returns empty structures for no arguments', () => {
    expect(parseArgs([])).toEqual({ flags: {}, positional: [] });
  });

  it('lets a later occurrence win', () => {
    expect(parseArgs(['--limit', '5', '--limit', '9']).flags).toEqual({ limit: '9' });
  });
});
