import type { Document, QualityScore } from '@zwep/shared';

/**
 * Lightweight, transparent quality scoring for indexed documents.
 *
 * Composite (0..1) = weighted mean of four signals:
 *   - length    0.40  content volume (log-scaled, ~1200 chars = full)
 *   - freshness 0.25  recency of published_at (1.0 if unknown)
 *   - title     0.20  title clarity (length + non-generic)
 *   - structure 0.15  heading / semantic structure
 *
 * Weights are exported so the admin console can show the breakdown and so
 * tuning stays in one place.
 */
export const WEIGHTS = {
  length: 0.4,
  freshness: 0.25,
  title: 0.2,
  structure: 0.15,
} as const;

const NOW = Date.now();
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function lengthScore(textLen: number): number {
  // log scale: ~200 chars -> 0.3, ~1200 -> 0.9, >3000 -> ~1.0
  if (textLen <= 0) return 0;
  const s = Math.log10(textLen + 1) / Math.log10(3001);
  return Math.max(0, Math.min(1, s));
}

function freshnessScore(publishedAt?: string): number {
  if (!publishedAt) return 1; // unknown age is not penalised
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return 1;
  const age = NOW - t;
  if (age < 0) return 1;
  // 0 years -> 1.0, 2+ years -> 0.2 floor
  const years = age / YEAR_MS;
  return Math.max(0.2, 1 - years / 2.5);
}

function titleScore(title: string): number {
  const t = title.trim();
  if (!t) return 0;
  // penalise generic/homepage titles
  const generic = /^(home|homepage|welcome|index|untitled|start)$/i.test(t);
  const len = t.length;
  let s = 0.5;
  if (len >= 15 && len <= 90) s += 0.35;
  else if (len > 8) s += 0.15;
  if (generic) s -= 0.4;
  return Math.max(0, Math.min(1, s));
}

function structureScore(headings: string[]): number {
  const n = headings?.length ?? 0;
  if (n === 0) return 0.2;
  if (n === 1) return 0.6;
  return Math.min(1, 0.6 + Math.min(n, 6) * 0.07);
}

export function scoreDocument(doc: Partial<Document>): QualityScore {
  const length = lengthScore((doc.content ?? '').trim().length);
  const freshness = freshnessScore(doc.published_at);
  const title = titleScore(doc.title ?? '');
  const structure = structureScore(doc.headings ?? []);
  const score =
    length * WEIGHTS.length +
    freshness * WEIGHTS.freshness +
    title * WEIGHTS.title +
    structure * WEIGHTS.structure;
  return {
    score: Math.round(score * 1000) / 1000,
    length: Math.round(length * 1000) / 1000,
    freshness: Math.round(freshness * 1000) / 1000,
    title: Math.round(title * 1000) / 1000,
    structure: Math.round(structure * 1000) / 1000,
  };
}

/** Human label for a 0..1 score band. */
export function qualityBand(score: number): 'low' | 'medium' | 'high' {
  if (score >= 0.7) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}
