import { afterEach, describe, expect, it } from 'vitest';
import { WEIGHTS, qualityBand, scoreDocument, setQualityClock } from '@zwep/quality';

const FIXED_NOW = Date.parse('2026-01-01T00:00:00Z');

afterEach(() => setQualityClock(null));

describe('scoreDocument', () => {
  it('returns every component plus a composite, all within 0..1', () => {
    const q = scoreDocument({ content: 'x'.repeat(800), title: 'A reasonable page title' });
    for (const key of ['score', 'length', 'freshness', 'title', 'structure'] as const) {
      expect(q[key]).toBeGreaterThanOrEqual(0);
      expect(q[key]).toBeLessThanOrEqual(1);
    }
  });

  it('composes the score from the documented weights', () => {
    const q = scoreDocument({
      content: 'x'.repeat(1500),
      title: 'A clear, descriptive article title',
      headings: ['One', 'Two', 'Three'],
      published_at: '2025-06-01T00:00:00Z',
    });
    const expected =
      q.length * WEIGHTS.length +
      q.freshness * WEIGHTS.freshness +
      q.title * WEIGHTS.title +
      q.structure * WEIGHTS.structure;
    expect(q.score).toBeCloseTo(Math.round(expected * 1000) / 1000, 3);
  });

  it('scores a long, structured, fresh document above a thin one', () => {
    setQualityClock(() => FIXED_NOW);
    const rich = scoreDocument({
      content: 'word '.repeat(600),
      title: 'How the Zwep crawler honours robots.txt',
      headings: ['Intro', 'Rules', 'Delays', 'Summary'],
      published_at: '2025-12-01T00:00:00Z',
    });
    const thin = scoreDocument({ content: 'hi', title: 'Home', headings: [] });
    expect(rich.score).toBeGreaterThan(thin.score);
  });

  it('does not penalise an unknown publication date', () => {
    expect(scoreDocument({ content: 'x'.repeat(500), title: 'T' }).freshness).toBe(1);
  });

  it('penalises generic homepage titles', () => {
    const generic = scoreDocument({ content: 'x'.repeat(500), title: 'Home' });
    const specific = scoreDocument({ content: 'x'.repeat(500), title: 'Quarterly climate report' });
    expect(specific.title).toBeGreaterThan(generic.title);
  });

  it('handles an entirely empty document without throwing', () => {
    const q = scoreDocument({});
    expect(q.score).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(q.score)).toBe(false);
  });
});

describe('freshness clock', () => {
  it('uses the injected clock rather than a value captured at import time', () => {
    // Regression guard: `NOW` was a module-level constant, so a long-running
    // process kept scoring stale documents as fresh.
    const published = '2024-01-01T00:00:00Z';
    setQualityClock(() => Date.parse('2024-01-02T00:00:00Z'));
    const justPublished = scoreDocument({ published_at: published }).freshness;
    setQualityClock(() => Date.parse('2029-01-01T00:00:00Z'));
    const veryOld = scoreDocument({ published_at: published }).freshness;
    expect(justPublished).toBeGreaterThan(veryOld);
  });

  it('never drops below the documented 0.2 floor', () => {
    setQualityClock(() => Date.parse('2099-01-01T00:00:00Z'));
    expect(scoreDocument({ published_at: '2000-01-01T00:00:00Z' }).freshness).toBe(0.2);
  });

  it('ignores an unparseable date instead of producing NaN', () => {
    expect(scoreDocument({ published_at: 'yesterday-ish' }).freshness).toBe(1);
  });
});

describe('qualityBand', () => {
  it.each([
    [0.95, 'high'],
    [0.7, 'high'],
    [0.69, 'medium'],
    [0.45, 'medium'],
    [0.44, 'low'],
    [0, 'low'],
  ])('maps %s to %s', (score, band) => {
    expect(qualityBand(score as number)).toBe(band);
  });
});
