/**
 * Language normalization.
 *
 * `franc` reports ISO 639-3 codes (`deu`, `eng`, `fra`) while HTML `lang`
 * attributes and every consumer of the API use ISO 639-1 (`de`, `en`, `fr`).
 * Mixing them split the `lang` facet in two — "de" and "deu" as separate
 * buckets for the same language — so everything funnels through here.
 */

const ISO3_TO_ISO1: Record<string, string> = {
  deu: 'de',
  ger: 'de',
  eng: 'en',
  fra: 'fr',
  fre: 'fr',
  spa: 'es',
  ita: 'it',
  nld: 'nl',
  dut: 'nl',
  por: 'pt',
  pol: 'pl',
  ces: 'cs',
  cze: 'cs',
  slk: 'sk',
  slv: 'sl',
  hrv: 'hr',
  srp: 'sr',
  ron: 'ro',
  rum: 'ro',
  hun: 'hu',
  ell: 'el',
  gre: 'el',
  bul: 'bg',
  rus: 'ru',
  ukr: 'uk',
  tur: 'tr',
  swe: 'sv',
  dan: 'da',
  nob: 'no',
  nno: 'no',
  nor: 'no',
  fin: 'fi',
  isl: 'is',
  est: 'et',
  lav: 'lv',
  lit: 'lt',
  cat: 'ca',
  eus: 'eu',
  glg: 'gl',
  heb: 'he',
  arb: 'ar',
  ara: 'ar',
  fas: 'fa',
  per: 'fa',
  hin: 'hi',
  ben: 'bn',
  urd: 'ur',
  tam: 'ta',
  tel: 'te',
  tha: 'th',
  vie: 'vi',
  ind: 'id',
  msa: 'ms',
  zsm: 'ms',
  jpn: 'ja',
  kor: 'ko',
  cmn: 'zh',
  zho: 'zh',
  chi: 'zh',
};

/** Returned when the language cannot be determined. */
export const UNKNOWN_LANG = 'und';

/**
 * Normalize any language identifier to a lowercase ISO 639-1 code.
 * Falls back to `und` ("undetermined") rather than guessing English.
 */
export function normalizeLang(input: string | null | undefined): string {
  if (!input) return UNKNOWN_LANG;
  const base = input.trim().toLowerCase().split(/[-_]/)[0];
  if (!base) return UNKNOWN_LANG;
  if (base === 'und' || base === 'mis' || base === 'mul') return UNKNOWN_LANG;
  if (base.length === 2) return base;
  return ISO3_TO_ISO1[base] ?? UNKNOWN_LANG;
}
