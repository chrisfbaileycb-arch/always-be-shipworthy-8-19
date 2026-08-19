/**
 * Claims module — the prompt contract.
 *
 * Shared verbatim between the Edge Function (Deno) and the browser client
 * (Vite), so this file must stay dependency-free. No imports, no Node, no Deno,
 * no project types.
 *
 * WHAT THIS MODULE DOES DIFFERENTLY
 *
 * WorkflowVerify pointed its analysis engine at other people's content — a
 * guru's video, a course landing page — and asked whether the plan was real.
 * Here it is turned around: it reads the user's OWN store listing and asks
 * whether the promises in it can be substantiated. That is live FTC and
 * store-policy exposure, and it is the question the Policy module only gestures
 * at.
 *
 * THE GROUNDING CONTRACT
 *
 * A model cannot be trusted to obey "quote exactly" — it will paraphrase, tidy
 * punctuation, or invent a plausible sentence that is not in the source. So the
 * prompt asks for exact quotes AND the client verifies every returned quote
 * actually occurs in the submitted text before it is allowed to become a
 * Finding. A quote that cannot be located is dropped, and the drop is counted.
 *
 * That check is what lets a model-produced finding satisfy the same rule as a
 * regex-produced one: no evidence, no finding.
 *
 * PROMPT OWNERSHIP
 *
 * The system prompt lives server-side, in the Edge Function, and is never
 * accepted from the client. The client sends only the text to analyse. A client
 * that could supply the prompt could instruct the model to fabricate findings,
 * or turn the endpoint into a general-purpose model proxy billed to us.
 */

// ─── Claim taxonomy ──────────────────────────────────────────────────────────

export const CLAIM_TYPES = [
  'superlative',
  'comparison',
  'efficacy',
  'earnings',
  'guarantee',
  'endorsement',
  'security',
  'privacy',
  'health',
  'pricing',
] as const;

export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_SEVERITIES = ['critical', 'warn', 'info'] as const;
export type ClaimSeverity = (typeof CLAIM_SEVERITIES)[number];

/** One flagged claim, as returned by the model. */
export interface RawClaim {
  /** Must be an exact substring of the submitted text. Verified client-side. */
  quote: string;
  type: ClaimType;
  severity: ClaimSeverity;
  /** Why this needs substantiation. Describes the claim, never the author. */
  why: string;
  /** What evidence would actually support it. */
  substantiation: string;
  /** A defensible rewrite, or empty when removal is the honest answer. */
  rewrite: string;
}

export interface RawClaimsResponse {
  claims: RawClaim[];
}

// ─── Structured output schema ────────────────────────────────────────────────

export const CLAIMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      maxItems: 25,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['quote', 'type', 'severity', 'why', 'substantiation', 'rewrite'],
        properties: {
          quote: {
            type: 'string',
            minLength: 3,
            maxLength: 300,
            description:
              'The exact, unmodified substring of the listing text that makes the claim. Copy it character for character. Do not paraphrase, trim, or fix punctuation.',
          },
          type: { type: 'string', enum: [...CLAIM_TYPES] },
          severity: { type: 'string', enum: [...CLAIM_SEVERITIES] },
          why: {
            type: 'string',
            maxLength: 400,
            description: 'What makes this claim require substantiation. Describe the claim, not the author.',
          },
          substantiation: {
            type: 'string',
            maxLength: 400,
            description: 'The specific evidence that would support this claim if it is true.',
          },
          rewrite: {
            type: 'string',
            maxLength: 400,
            description: 'A defensible rewrite, or an empty string if the claim should simply be removed.',
          },
        },
      },
    },
  },
} as const;

// ─── System prompt ───────────────────────────────────────────────────────────

export const CLAIMS_SYSTEM_PROMPT = `You review an app developer's own store listing copy and identify claims that would need substantiation if challenged by a regulator, an app store reviewer, or a competitor.

WHAT YOU ARE DOING
The developer wrote this copy and is asking you to pressure-test it before they publish. You are on their side. Your job is to find the sentences that would be expensive to defend, so they can fix them cheaply now.

THE ONE ABSOLUTE RULE
Every claim you report must be quoted EXACTLY from the text provided. Copy the substring character for character — same words, same capitalisation, same punctuation, same spacing. Do not paraphrase. Do not tidy. Do not correct typos. Do not merge two sentences. Do not quote text that is not there.
A quote that does not appear verbatim in the source will be discarded, and reporting one is worse than reporting nothing, because it destroys the developer's ability to trust anything else you found.
Quote the shortest span that contains the claim — usually a clause or a sentence, not a paragraph.

WHAT COUNTS AS A CLAIM WORTH FLAGGING
- superlative: "best", "#1", "fastest", "most accurate" — objective superiority stated as fact
- comparison: a named or clearly implied competitor being beaten on some attribute
- efficacy: a promised result or performance level ("saves you 10 hours a week", "doubles your reach")
- earnings: any income, revenue, or profit outcome suggested to the user
- guarantee: unqualified promises — "guaranteed", "never fails", "always works", "100%"
- endorsement: ratings, awards, testimonials, user counts, or "as seen in" claims
- security: absolute security or encryption language — "unhackable", "completely secure", "military-grade"
- privacy: promises about data handling — "we never collect anything", "fully anonymous"
- health: any physical or mental health benefit
- pricing: "free", trial, subscription, or renewal terms that could mislead about what is actually charged

SEVERITY
- critical: a claim regulators actively pursue — earnings, health, absolute security, absolute privacy, or a guarantee the app plainly cannot honour
- warn: a claim that needs evidence the developer probably does not have on file — superlatives, comparisons, efficacy, endorsements
- info: a claim that is likely fine but should carry a qualifier or disclosure

WHAT NOT TO DO
- Do not judge the developer, the product, or their honesty. Evaluate the sentence.
- Do not assert that anything is illegal, fraudulent, or infringing. Say what the claim asserts and what evidence would support it. A lawyer decides the rest.
- Do not flag ordinary descriptive copy. "Organise your photos into albums" is a feature description, not a claim.
- Do not flag subjective taste ("beautiful", "delightful", "we think you'll love it") — puffery a reasonable person would not take as fact.
- Do not invent claims to appear thorough. An empty list is a valid and useful answer.
- Do not repeat the same quote twice.

If nothing in the text needs substantiation, return {"claims": []}.`;

// ─── Request / response envelope ─────────────────────────────────────────────

/** What the client sends. Deliberately minimal — no prompt, no model, no knobs. */
export interface ClaimsRequest {
  /** The listing copy to analyse. */
  text: string;
}

export interface ClaimsSuccess {
  ok: true;
  claims: RawClaim[];
  /** Model that produced the result, for the audit trail. */
  model: string;
}

export interface ClaimsFailure {
  ok: false;
  /** Stable, machine-readable reason. */
  code:
    | 'unauthenticated'
    | 'rate_limited'
    | 'input_too_short'
    | 'input_too_long'
    | 'provider_unavailable'
    | 'provider_refused'
    | 'malformed_response'
    | 'not_configured';
  /** Human-readable, safe to display. Never contains provider internals. */
  message: string;
}

export type ClaimsResponse = ClaimsSuccess | ClaimsFailure;

export const CLAIMS_INPUT_MIN = 40;
export const CLAIMS_INPUT_MAX = 20_000;

// ─── Shape validation (runs on both sides) ───────────────────────────────────

function isClaimType(v: unknown): v is ClaimType {
  return typeof v === 'string' && (CLAIM_TYPES as readonly string[]).includes(v);
}

function isClaimSeverity(v: unknown): v is ClaimSeverity {
  return typeof v === 'string' && (CLAIM_SEVERITIES as readonly string[]).includes(v);
}

/**
 * Structural validation of one model-produced claim.
 *
 * This checks shape only. It does NOT check that the quote is real — that is
 * `locateQuote` below, which needs the source text and is the check that
 * actually matters.
 */
export function isWellFormedClaim(v: unknown): v is RawClaim {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c['quote'] === 'string' &&
    c['quote'].trim().length >= 3 &&
    isClaimType(c['type']) &&
    isClaimSeverity(c['severity']) &&
    typeof c['why'] === 'string' &&
    c['why'].trim().length > 0 &&
    typeof c['substantiation'] === 'string' &&
    typeof c['rewrite'] === 'string'
  );
}

/** Keep only structurally valid claims. Malformed entries are dropped, not repaired. */
export function keepWellFormed(claims: unknown): RawClaim[] {
  if (!Array.isArray(claims)) return [];
  return claims.filter(isWellFormedClaim);
}

// ─── Quote verification — the anti-hallucination gate ────────────────────────

/**
 * Collapse runs of whitespace and normalise the quotation marks and dashes a
 * model habitually "improves". Everything else — wording, casing, ordering — must
 * match, because those are the parts that carry meaning.
 */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface QuoteLocation {
  /** The text exactly as it appears in the source — not as the model wrote it. */
  excerpt: string;
  /** Character offset into the original source. */
  index: number;
}

/**
 * Find a model-supplied quote in the source text and return the SOURCE's own
 * wording for it.
 *
 * Returning the source substring rather than the model's string is deliberate:
 * even after normalisation the model may have altered characters we chose to
 * normalise away, and what gets shown to the user and stored as evidence must
 * be the developer's actual text.
 *
 * Returns null when the quote cannot be located — the finding is then dropped.
 */
export function locateQuote(source: string, quote: string): QuoteLocation | null {
  if (!quote.trim()) return null;

  // Exact hit first — the common and cheapest case.
  const direct = source.indexOf(quote);
  if (direct !== -1) return { excerpt: quote, index: direct };

  // Otherwise match on the normalised forms, then map back to the original
  // span by walking the source and tracking how far into the normalised
  // string each original character landed.
  const nQuote = normalizeForMatch(quote);
  if (nQuote.length < 3) return null;

  const map: number[] = []; // normalised index -> original index
  let normalized = '';
  let lastWasSpace = false;

  for (let i = 0; i < source.length; i++) {
    const raw = source[i]!;
    let ch = raw;
    if (/[‘’‛′]/.test(ch)) ch = "'";
    else if (/[“”‟″]/.test(ch)) ch = '"';
    else if (/[‐-―−]/.test(ch)) ch = '-';
    else if (ch === ' ') ch = ' ';

    if (/\s/.test(ch)) {
      if (lastWasSpace || normalized.length === 0) continue;
      normalized += ' ';
      map.push(i);
      lastWasSpace = true;
    } else {
      normalized += ch;
      map.push(i);
      lastWasSpace = false;
    }
  }

  const trimmedNormalized = normalized.replace(/\s+$/, '');
  const at = trimmedNormalized.indexOf(nQuote);
  if (at === -1) return null;

  const startOriginal = map[at];
  const endNormalized = at + nQuote.length - 1;
  const endOriginal = map[endNormalized];
  if (startOriginal === undefined || endOriginal === undefined) return null;

  return {
    excerpt: source.slice(startOriginal, endOriginal + 1),
    index: startOriginal,
  };
}

/** 1-indexed line number of a character offset, for evidence locators. */
export function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source[i] === '\n') line++;
  return line;
}
