/**
 * Listing module — store metadata audit.
 *
 * Ported from SHIFT Pre-Flight's `auditMarketing`. Limits now come from the
 * dated registry rather than inline literals, and a listing with no title and no
 * description returns `not_assessed` instead of a clean-looking score.
 */

import { assessed, makeFinding, notAssessed } from '../core/finding';
import { LISTING_LIMITS, type RuleId } from '../core/rules';
import type { Finding, ModuleResult } from '../core/types';

const MODULE = 'listing' as const;

/**
 * Third-party marks commonly used in comparative store copy. This is a
 * heuristic word list, not a registry lookup — findings from it are marked
 * `heuristic` and never assert that a mark is registered or infringed.
 */
export const WATCHED_MARKS = [
  'uber', 'airbnb', 'tiktok', 'instagram', 'facebook', 'whatsapp', 'snapchat',
  'netflix', 'spotify', 'youtube', 'fortnite', 'minecraft', 'pokemon', 'chatgpt',
  'photoshop', 'tinder', 'roblox', 'duolingo',
];

const STOPWORDS = new Set(
  ('the a an and or but for nor with your you our their its this that these those from into onto over ' +
    'under about after before while when where what which who will shall can could would should may might ' +
    'must have has had was were are is be been being do does did not all any each more most other some ' +
    'such only own same so than too very just app apps get make also then them they there here how why out off')
    .split(' '),
);

export interface ListingInput {
  title: string;
  shortDescription: string;
  description: string;
}

export function auditListing({ title, shortDescription, description }: ListingInput): ModuleResult {
  const t = title.trim();
  const sd = shortDescription.trim();
  const d = description.trim();

  // Nothing substantive to read means no score.
  if (!t && !d) {
    return notAssessed(MODULE, [
      'your store title',
      'your full store description',
    ]);
  }

  const findings: Finding[] = [];
  const checksRun: RuleId[] = [];
  const run = (ruleId: RuleId, fn: () => Finding | null) => {
    checksRun.push(ruleId);
    const f = fn();
    if (f) findings.push(f);
  };

  // ── title ──────────────────────────────────────────────────────────────────
  if (t) {
    run('listing.title.length', () => {
      if (t.length <= LISTING_LIMITS.titleMax) return null;
      return makeFinding({
        module: MODULE,
        ruleId: 'listing.title.length',
        severity: 'warn',
        title: `Title is ${t.length} characters (limit ${LISTING_LIMITS.titleMax})`,
        evidence: { excerpt: t, locator: 'listing.title', source: 'title' },
        fix: `Trim to ${LISTING_LIMITS.titleMax} characters and move the extra keywords into the short description.`,
      });
    });

    run('listing.title.promo-symbols', () => {
      const m = t.match(/!|[A-Z]{5,}|#1/);
      if (!m) return null;
      return makeFinding({
        module: MODULE,
        ruleId: 'listing.title.promo-symbols',
        severity: 'warn',
        title: 'Promotional symbols or caps in title',
        evidence: { excerpt: m[0], locator: 'listing.title', source: 'title' },
        fix: 'Remove exclamation marks, all-caps runs, emoji, and rank claims like "#1". This is one of the most common metadata rejections.',
      });
    });
  }

  // ── short description ──────────────────────────────────────────────────────
  if (sd) {
    run('listing.short-desc.length', () => {
      if (sd.length <= LISTING_LIMITS.shortDescriptionMax) return null;
      return makeFinding({
        module: MODULE,
        ruleId: 'listing.short-desc.length',
        severity: 'warn',
        title: `Short description is ${sd.length} characters (limit ${LISTING_LIMITS.shortDescriptionMax})`,
        evidence: { excerpt: sd, locator: 'listing.shortDescription', source: 'shortDescription' },
        fix: `Cut to ${LISTING_LIMITS.shortDescriptionMax} characters, front-loading the value proposition — Play truncates the rest.`,
      });
    });
  }

  // ── description ────────────────────────────────────────────────────────────
  if (d) {
    run('listing.description.length-max', () => {
      if (d.length <= LISTING_LIMITS.descriptionMax) return null;
      return makeFinding({
        module: MODULE,
        ruleId: 'listing.description.length-max',
        severity: 'warn',
        title: `Description is ${d.length} characters (limit ${LISTING_LIMITS.descriptionMax})`,
        evidence: { excerpt: d.slice(0, 120), locator: 'listing.description', source: 'description' },
        fix: `Cut to ${LISTING_LIMITS.descriptionMax} characters.`,
      });
    });

    run('listing.description.length-min', () => {
      if (d.length >= LISTING_LIMITS.descriptionAdvisoryMin) return null;
      return makeFinding({
        module: MODULE,
        ruleId: 'listing.description.length-min',
        severity: 'info',
        title: `Description is only ${d.length} characters`,
        evidence: { excerpt: d, locator: 'listing.description', source: 'description' },
        fix: 'Aim for two to four short paragraphs. Store search indexes this field, and there is very little here to rank.',
      });
    });

    const words = d.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? [];

    run('listing.description.keyword-stuffing', () => {
      if (words.length === 0) return null;
      const freq = new Map<string, number>();
      for (const w of words) if (!STOPWORDS.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
      const stuffed = [...freq.entries()].filter(
        ([, n]) =>
          n >= LISTING_LIMITS.keywordRepeatThreshold &&
          n / words.length > LISTING_LIMITS.keywordDensityThreshold,
      );
      if (stuffed.length === 0) return null;
      const worst = stuffed.sort((a, b) => b[1] - a[1])[0]!;
      return makeFinding({
        module: MODULE,
        ruleId: 'listing.description.keyword-stuffing',
        severity: 'warn',
        title: `Possible keyword stuffing: ${stuffed.map(([w, n]) => `"${w}" ×${n}`).join(', ')}`,
        evidence: {
          excerpt: excerptAround(d, worst[0]),
          locator: 'listing.description',
          source: 'description',
        },
        fix: 'Replace the repeats with synonyms and natural sentences. Repetitive metadata violates Play policy and reads badly to a human.',
      });
    });

    run('listing.description.trademark-mention', () => {
      const hits = WATCHED_MARKS.filter((mk) => new RegExp(`\\b${mk}\\b`, 'i').test(d));
      if (hits.length === 0) return null;
      const first = d.match(new RegExp(`\\b${hits[0]}\\b`, 'i'));
      return makeFinding({
        module: MODULE,
        ruleId: 'listing.description.trademark-mention',
        severity: 'warn',
        // Deliberate wording: names the pattern, not a legal conclusion.
        title: `Third-party brand name${hits.length > 1 ? 's' : ''} in description: ${hits.join(', ')}`,
        evidence: {
          excerpt: first ? excerptAround(d, first[0]) : hits[0]!,
          locator: 'listing.description',
          source: 'description',
        },
        confidence: 'heuristic',
        fix: 'Describe the category rather than naming a competitor. Store IP policies allow takedown requests against metadata that references another brand.',
      });
    });

    run('listing.description.superlative-claims', () => {
      const m = d.match(/\b(best|#1|number one|top rated|editor'?s choice|guaranteed)\b/i);
      if (!m) return null;
      return makeFinding({
        module: MODULE,
        ruleId: 'listing.description.superlative-claims',
        severity: 'info',
        title: `Unsubstantiated superlative: "${m[0]}"`,
        evidence: { excerpt: excerptAround(d, m[0]), locator: 'listing.description', source: 'description' },
        fix: 'Rephrase around a concrete benefit you can demonstrate. Rank claims need substantiation to survive review.',
      });
    });
  }

  return assessed(MODULE, findings, checksRun);
}

/** A readable window of text around a match, for evidence excerpts. */
function excerptAround(text: string, needle: string, pad = 45): string {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return needle;
  const start = Math.max(0, i - pad);
  const end = Math.min(text.length, i + needle.length + pad);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}
