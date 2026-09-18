import { describe, expect, it } from 'vitest';
import { oneLine } from '@zwep/config';
import { KnowledgeGraph } from '@zwep/graph';
import { isGoogleOwned } from '@zwep/crawler';

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

/**
 * Regression guards for the findings CodeQL raised on pull request #1.
 * Each test names the rule it locks down.
 */

describe('isGoogleOwned — js/incomplete-url-substring-sanitization', () => {
  it('matches Google domains and their subdomains', () => {
    expect(isGoogleOwned('https://google.com/x')).toBe(true);
    expect(isGoogleOwned('https://www.google.com/x')).toBe(true);
    expect(isGoogleOwned('https://news.google.com/x')).toBe(true);
    expect(isGoogleOwned('https://lh3.googleusercontent.com/a')).toBe(true);
    expect(isGoogleOwned('https://ssl.gstatic.com/a')).toBe(true);
  });

  it('does not match a look-alike domain that merely ends with the string', () => {
    // `endsWith('google.com')` also matched these, so a look-alike host was
    // classified as Google's own infrastructure.
    expect(isGoogleOwned('https://evilgoogle.com/x')).toBe(false);
    expect(isGoogleOwned('https://notgoogle.com/x')).toBe(false);
    expect(isGoogleOwned('https://mygstatic.com/x')).toBe(false);
  });

  it('does not match a domain that merely contains the string', () => {
    expect(isGoogleOwned('https://google.com.evil.example/x')).toBe(false);
  });

  it('returns false for an unparseable link', () => {
    expect(isGoogleOwned('not a url')).toBe(false);
  });
});

describe('entity slug — js/polynomial-redos', () => {
  it('trims separators from both ends', () => {
    const [e] = KnowledgeGraph.extractEntities('Berlin');
    expect(e.label).toBe('Berlin');
  });

  it('handles a long run of separators in linear time', () => {
    // The old `/^_+|_+$/` backtracked polynomially, so a page of punctuation
    // was a cheap way to stall a crawl. 50k separators must stay instant.
    const hostile = `${'-'.repeat(50_000)}Berlin${'-'.repeat(50_000)}`;
    const started = Date.now();
    const ents = KnowledgeGraph.extractEntities(hostile);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(ents.some((e) => e.label === 'Berlin')).toBe(true);
  });
});

describe('oneLine — js/log-injection', () => {
  it('collapses newlines so a message cannot forge a second log entry', () => {
    const forged = 'boom\n[llm] provider ok: everything is fine';
    expect(oneLine(forged)).toBe('boom [llm] provider ok: everything is fine');
    expect(oneLine(forged)).not.toContain('\n');
  });

  it('strips carriage returns, tabs and other control characters', () => {
    expect(oneLine('a\rb\tcd')).toBe('a b c d');
  });

  it('strips the Unicode line and paragraph separators', () => {
    // These terminate a line in some log viewers even though they are not \n.
    expect(oneLine(`a${LS}b${PS}c`)).toBe('a b c');
  });

  it('truncates to the requested budget', () => {
    expect(oneLine('x'.repeat(1000), 50)).toHaveLength(50);
  });

  it('handles nullish input', () => {
    expect(oneLine(null)).toBe('');
    expect(oneLine(undefined)).toBe('');
  });

  it('leaves ordinary text untouched', () => {
    expect(oneLine('Ollama generate failed: 500')).toBe('Ollama generate failed: 500');
  });
});
