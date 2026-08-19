/**
 * The rules registry.
 *
 * Every threshold, limit, and policy reference in Shipworthy lives here and
 * nowhere else. No check may hardcode a number.
 *
 * This exists because of a specific failure. SHIFT Pre-Flight carried its Google
 * Play target-SDK floor as a literal inside a sentence —
 *
 *     '…(API 35 as of Aug 2025, rising yearly)…'
 *
 * — alongside a bare `v < 35` comparison. Play raises that floor every year, so
 * the scanner was giving confidently stale advice with no way to notice. A
 * scanner that is quietly wrong is worse than no scanner, because the developer
 * stops checking for themselves.
 *
 * Maintenance contract:
 *   - Every entry carries `asOf`, the date its text was last confirmed at source.
 *   - `RULES_AS_OF` below is the oldest `asOf` in the registry, and is surfaced
 *     in every report as "rules current as of …".
 *   - Re-confirm anything with a `reviewBy` date that has passed.
 */

export interface RuleDef {
  /** Who sets this rule. */
  authority: string;
  /** Where the rule is published. */
  url: string;
  /** ISO date this entry was last confirmed against `url`. */
  asOf: string;
  /** Re-confirm on or before this date — set where a rule is known to move. */
  reviewBy?: string;
  /** One-line statement of the rule, for display next to a finding. */
  statement: string;
}

// ─── Play / App Store source URLs ────────────────────────────────────────────

const PLAY_TARGET_API_URL = 'https://support.google.com/googleplay/android-developer/answer/11926878';
const PLAY_METADATA = 'https://support.google.com/googleplay/android-developer/answer/9898842';
const PLAY_PRIVACY = 'https://support.google.com/googleplay/android-developer/answer/10144311';
const PLAY_BILLING = 'https://support.google.com/googleplay/android-developer/answer/10281818';
const PLAY_FAMILIES = 'https://support.google.com/googleplay/android-developer/answer/9893335';
const PLAY_PERMISSIONS = 'https://support.google.com/googleplay/android-developer/answer/9888170';
const APPLE_REVIEW = 'https://developer.apple.com/app-store/review/guidelines/';
const ANDROID_SECURITY = 'https://developer.android.com/privacy-and-security/security-best-practices';
const APPLE_ATS = 'https://developer.apple.com/documentation/security/preventing-insecure-network-connections';

// ─── Google Play target API level ────────────────────────────────────────────

/**
 * Confirmed 2026-08-19 against Play Console Help.
 *
 * The floor is not one number — it varies by form factor, and the headline
 * number changes on a hard date twelve days from this confirmation. A single
 * `v < 35` comparison cannot express this, which is precisely why SHIFT's was
 * about to become wrong.
 */
export const PLAY_TARGET_API = {
  /** New apps and updates must meet this to be *submitted*. */
  submission: {
    /** In force until `changesOn`. */
    current: 35,
    /** In force from `changesOn`. */
    next: 36,
    /** ISO date the floor rises. */
    changesOn: '2026-08-31',
    /** Developers may request an extension to this date. */
    extensionUntil: '2026-11-01',
  },
  /** Existing apps need this to stay available to new users on newer Android. */
  existingAppVisibility: 35,
  /** Form factors with their own, lower floors. */
  formFactor: {
    wearOs: 35,
    automotive: 35,
    tv: 34,
    xr: 34,
  },
  asOf: '2026-08-19',
} as const;

/**
 * The submission floor in force on a given date. Pass the scan date so a report
 * is reproducible — never read the clock inside a rule.
 */
export function playSubmissionFloor(on: Date): number {
  const { current, next, changesOn } = PLAY_TARGET_API.submission;
  return on >= new Date(changesOn + 'T00:00:00Z') ? next : current;
}

/** True when the floor rises within `days` of `on` — worth warning about early. */
export function playFloorRisingSoon(on: Date, days = 90): boolean {
  const change = new Date(PLAY_TARGET_API.submission.changesOn + 'T00:00:00Z').getTime();
  const delta = change - on.getTime();
  return delta > 0 && delta <= days * 86_400_000;
}

// ─── Store metadata limits ───────────────────────────────────────────────────

export const LISTING_LIMITS = {
  /** Play title hard limit; App Store name field is also 30. */
  titleMax: 30,
  shortDescriptionMax: 80,
  descriptionMax: 4000,
  /** Below this, store search has almost nothing to index. Advisory, not policy. */
  descriptionAdvisoryMin: 80,
  /** Repeats of one keyword before stuffing is flagged. */
  keywordRepeatThreshold: 6,
  /** …and the share of total words it must exceed. */
  keywordDensityThreshold: 0.03,
  asOf: '2026-08-19',
} as const;

// ─── Registry ────────────────────────────────────────────────────────────────

export const RULES = {
  // ── build ──────────────────────────────────────────────────────────────────
  'build.secret.aws-key': {
    authority: 'AWS security best practices',
    url: 'https://docs.aws.amazon.com/general/latest/gr/aws-access-keys-best-practices.html',
    asOf: '2026-08-19',
    statement: 'Long-lived AWS access keys must not be embedded in distributed client code.',
  },
  'build.secret.google-api-key': {
    authority: 'Google Cloud API key best practices',
    url: 'https://cloud.google.com/docs/authentication/api-keys',
    asOf: '2026-08-19',
    statement: 'API keys shipped in an app must be restricted by application and API scope.',
  },
  'build.secret.stripe-live-key': {
    authority: 'Stripe API keys documentation',
    url: 'https://docs.stripe.com/keys',
    asOf: '2026-08-19',
    statement: 'Secret keys must never be used in client-side code.',
  },
  'build.secret.private-key': {
    authority: 'Android security best practices',
    url: ANDROID_SECURITY,
    asOf: '2026-08-19',
    statement: 'Private key material must not ship inside an application package.',
  },
  'build.secret.generic-credential': {
    authority: 'OWASP Mobile Top 10 — M1 Improper Credential Usage',
    url: 'https://owasp.org/www-project-mobile-top-10/',
    asOf: '2026-08-19',
    statement: 'Credentials hardcoded into a client binary are trivially extractable.',
  },
  'build.cleartext.http-url': {
    authority: 'Android network security configuration',
    url: 'https://developer.android.com/privacy-and-security/security-config',
    asOf: '2026-08-19',
    statement: 'Cleartext HTTP is blocked by default on current Android and iOS.',
  },
  'build.cleartext.android-flag': {
    authority: 'Android network security configuration',
    url: 'https://developer.android.com/privacy-and-security/security-config',
    asOf: '2026-08-19',
    statement: 'android:usesCleartextTraffic="true" re-enables unencrypted traffic app-wide.',
  },
  'build.cleartext.ios-ats': {
    authority: 'Apple App Transport Security',
    url: APPLE_ATS,
    asOf: '2026-08-19',
    statement: 'NSAllowsArbitraryLoads disables ATS entirely and requires review justification.',
  },
  'build.debug.android-debuggable': {
    authority: 'Google Play app quality requirements',
    url: ANDROID_SECURITY,
    asOf: '2026-08-19',
    statement: 'Debuggable builds are rejected by Google Play and expose runtime state.',
  },
  'build.backup.android-allow-backup': {
    authority: 'Android data backup documentation',
    url: 'https://developer.android.com/guide/topics/data/autobackup',
    asOf: '2026-08-19',
    statement: 'Auto-backup includes app data in device backups unless explicitly excluded.',
  },
  'build.sdk.play-target-floor': {
    authority: 'Google Play Console — target API level requirements',
    url: PLAY_TARGET_API_URL,
    asOf: '2026-08-19',
    reviewBy: '2026-09-30',
    statement: 'New apps and updates must target a recent API level to be submitted.',
  },
  'build.permissions.sensitive': {
    authority: 'Google Play permissions policy',
    url: PLAY_PERMISSIONS,
    asOf: '2026-08-19',
    statement: 'Sensitive permissions increase review scrutiny and must be necessary.',
  },
  'build.deps.wildcard-version': {
    authority: 'npm dependency management guidance',
    url: 'https://docs.npmjs.com/cli/v10/configuring-npm/package-json',
    asOf: '2026-08-19',
    statement: 'Unpinned dependencies make builds non-reproducible.',
  },
  'build.deps.not-private': {
    authority: 'npm package.json reference',
    url: 'https://docs.npmjs.com/cli/v10/configuring-npm/package-json',
    asOf: '2026-08-19',
    statement: 'Application packages should set "private": true to prevent publication.',
  },

  // ── listing ────────────────────────────────────────────────────────────────
  'listing.title.length': {
    authority: 'Google Play store listing requirements',
    url: PLAY_METADATA,
    asOf: '2026-08-19',
    statement: 'App titles are limited to 30 characters.',
  },
  'listing.title.promo-symbols': {
    authority: 'Google Play metadata policy',
    url: PLAY_METADATA,
    asOf: '2026-08-19',
    statement: 'Titles may not contain emoji, all-caps, exclamation marks, or rank claims.',
  },
  'listing.short-desc.length': {
    authority: 'Google Play store listing requirements',
    url: PLAY_METADATA,
    asOf: '2026-08-19',
    statement: 'Short descriptions are limited to 80 characters.',
  },
  'listing.description.length-max': {
    authority: 'Google Play store listing requirements',
    url: PLAY_METADATA,
    asOf: '2026-08-19',
    statement: 'Full descriptions are limited to 4000 characters.',
  },
  'listing.description.length-min': {
    authority: 'Shipworthy advisory',
    url: PLAY_METADATA,
    asOf: '2026-08-19',
    statement: 'Very short descriptions give store search little to index. Advisory only.',
  },
  'listing.description.keyword-stuffing': {
    authority: 'Google Play metadata policy',
    url: PLAY_METADATA,
    asOf: '2026-08-19',
    statement: 'Repetitive or irrelevant keywords in metadata violate policy.',
  },
  'listing.description.trademark-mention': {
    authority: 'Google Play intellectual property policy',
    url: 'https://support.google.com/googleplay/android-developer/answer/9888072',
    asOf: '2026-08-19',
    statement: 'Metadata referencing third-party marks can trigger takedown requests.',
  },
  'listing.description.superlative-claims': {
    authority: 'Google Play metadata policy',
    url: PLAY_METADATA,
    asOf: '2026-08-19',
    statement: 'Rank and performance claims are restricted unless substantiated.',
  },

  // ── policy ─────────────────────────────────────────────────────────────────
  'policy.billing.platform-required': {
    authority: 'Google Play payments policy / Apple App Review 3.1',
    url: PLAY_BILLING,
    asOf: '2026-08-19',
    statement: 'Digital goods must use platform billing.',
  },
  'policy.privacy.policy-required': {
    authority: 'Google Play user data policy / Apple App Review 5.1',
    url: PLAY_PRIVACY,
    asOf: '2026-08-19',
    statement: 'Every app must link a privacy policy and complete data disclosures.',
  },
  'policy.coppa.child-directed': {
    authority: 'Google Play Families policy / COPPA',
    url: PLAY_FAMILIES,
    asOf: '2026-08-19',
    statement: 'Child-directed apps carry restricted ads and consent obligations.',
  },
  'policy.permissions.unjustified': {
    authority: 'Google Play permissions policy',
    url: PLAY_PERMISSIONS,
    asOf: '2026-08-19',
    statement: 'Sensitive permissions require a user-facing purpose in the listing.',
  },
  'policy.ios.empty-usage-description': {
    authority: 'Apple App Review Guidelines 5.1.1',
    url: APPLE_REVIEW,
    asOf: '2026-08-19',
    statement: 'Permission usage descriptions must be specific; empty strings are rejected.',
  },
  'policy.health.medical-claims': {
    authority: 'Apple App Review Guidelines 1.4.1 / Play health content policy',
    url: APPLE_REVIEW,
    asOf: '2026-08-19',
    statement: 'Health claims attract additional review and possible device regulation.',
  },
  'policy.finance.regulated-category': {
    authority: 'Google Play financial services policy',
    url: 'https://support.google.com/googleplay/android-developer/answer/9876821',
    asOf: '2026-08-19',
    statement: 'Finance and real-money gaming require declarations and licensing.',
  },
  // ── watch ──────────────────────────────────────────────────────────────────
  // Production observability. Every finding here names the gap and offers a
  // menu, never a single vendor — see src/core/providers.ts.
  'watch.errors.not-instrumented': {
    authority: 'Google Play / App Store app quality guidance',
    url: 'https://developer.android.com/quality',
    asOf: '2026-08-19',
    statement: 'A production app without crash or error reporting fails silently for its users.',
  },
  'watch.errors.not-initialised': {
    authority: 'Shipworthy advisory',
    url: 'https://developer.android.com/quality',
    asOf: '2026-08-19',
    statement: 'An installed error-reporting SDK reports nothing until it is initialised with a project key.',
  },
  'watch.sourcemaps.published': {
    authority: 'OWASP — information exposure through source maps',
    url: 'https://owasp.org/www-project-web-security-testing-guide/',
    asOf: '2026-08-19',
    statement: 'Publishing source maps exposes original source, comments, and file layout to anyone.',
  },
  'watch.uptime.undeclared': {
    authority: 'Shipworthy advisory',
    url: 'https://developer.android.com/quality',
    asOf: '2026-08-19',
    statement: 'Uptime monitoring cannot be detected from a build config and must be declared.',
  },

  // ── name ───────────────────────────────────────────────────────────────────
  // Every rule here is backed by a live lookup or it does not fire. A finding
  // in this module without confidence:'verified' means the registry was never
  // reached, and it must say so rather than guess.
  'name.trademark.live-mark': {
    authority: 'USPTO Open Data Portal — trademark search',
    url: 'https://data.uspto.gov/apis/getting-started',
    asOf: '2026-08-19',
    reviewBy: '2026-12-01',
    statement: 'A live registered mark in a related class is a direct collision risk.',
  },
  'name.trademark.similar-mark': {
    authority: 'USPTO Open Data Portal — trademark search',
    url: 'https://data.uspto.gov/apis/getting-started',
    asOf: '2026-08-19',
    reviewBy: '2026-12-01',
    statement: 'Marks similar to an existing registration can be refused for likelihood of confusion.',
  },
  'name.domain.registered': {
    authority: 'RDAP (RFC 9082) — authoritative registry response',
    url: 'https://datatracker.ietf.org/doc/html/rfc9082',
    asOf: '2026-08-19',
    statement: 'The domain resolves to an existing registration in the authoritative registry.',
  },
  'name.domain.unregistered': {
    authority: 'RDAP (RFC 9082) — authoritative registry response',
    url: 'https://datatracker.ietf.org/doc/html/rfc9082',
    asOf: '2026-08-19',
    statement: 'No registration record exists. Not the same as being available to register.',
  },

  // ── claims ─────────────────────────────────────────────────────────────────
  // Substantiation, not taste. Every entry names a rule an advertiser is
  // actually held to, so a finding can cite something outside our own opinion.
  'claims.superlative.unsubstantiated': {
    authority: 'FTC Act §5 — advertising substantiation',
    url: 'https://www.ftc.gov/business-guidance/resources/advertising-faqs-guide-small-business',
    asOf: '2026-08-19',
    statement: 'Objective superiority claims require substantiation held before the claim is made.',
  },
  'claims.comparison.competitor': {
    authority: 'FTC Statement on Comparative Advertising',
    url: 'https://www.ftc.gov/legal-library/browse/statements-policy/statement-policy-regarding-comparative-advertising',
    asOf: '2026-08-19',
    statement: 'Comparative claims must be truthful and substantiated on the compared attribute.',
  },
  'claims.efficacy.unproven': {
    authority: 'FTC Act §5 — advertising substantiation',
    url: 'https://www.ftc.gov/business-guidance/resources/advertising-faqs-guide-small-business',
    asOf: '2026-08-19',
    statement: 'Performance and results claims require competent and reliable evidence.',
  },
  'claims.earnings.income': {
    authority: 'FTC Business Opportunity Rule / earnings-claim guidance',
    url: 'https://www.ftc.gov/business-guidance/resources/business-opportunity-rule-compliance-guide',
    asOf: '2026-08-19',
    statement: 'Earnings claims require substantiation and disclosure of typical results.',
  },
  'claims.guarantee.absolute': {
    authority: 'FTC Act §5 — deceptive absolute claims',
    url: 'https://www.ftc.gov/business-guidance/resources/advertising-faqs-guide-small-business',
    asOf: '2026-08-19',
    statement: 'Unqualified guarantees must be honoured as stated, without hidden conditions.',
  },
  'claims.endorsement.unverified': {
    authority: 'FTC Endorsement Guides (16 CFR Part 255)',
    url: 'https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking',
    asOf: '2026-08-19',
    statement: 'Endorsements, ratings, and awards must be genuine and connections disclosed.',
  },
  'claims.security.absolute': {
    authority: 'FTC data-security enforcement / Apple App Review 5.1',
    url: 'https://www.ftc.gov/business-guidance/privacy-security/data-security',
    asOf: '2026-08-19',
    statement: 'Absolute security claims ("unhackable", "100% secure") are treated as deceptive.',
  },
  'claims.privacy.overbroad': {
    authority: 'FTC Act §5 / Google Play user data policy',
    url: 'https://support.google.com/googleplay/android-developer/answer/10144311',
    asOf: '2026-08-19',
    statement: 'Privacy promises must match actual data practices and declared disclosures.',
  },
  'claims.health.medical': {
    authority: 'FTC Health Products Compliance Guidance',
    url: 'https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance',
    asOf: '2026-08-19',
    statement: 'Health benefit claims require competent and reliable scientific evidence.',
  },
  'claims.pricing.misleading': {
    authority: 'FTC pricing and negative-option guidance',
    url: 'https://www.ftc.gov/business-guidance/resources/negative-option-rule',
    asOf: '2026-08-19',
    statement: 'Price, "free", and renewal terms must be disclosed clearly and conspicuously.',
  },

  'policy.disclaimer.automated-results': {
    authority: 'FTC guidance on substantiation of advertising claims',
    url: 'https://www.ftc.gov/business-guidance/resources/advertising-faqs-guide-small-business',
    asOf: '2026-08-19',
    statement: 'Automated or AI-driven output described in marketing should carry an accuracy notice.',
  },
} as const satisfies Record<string, RuleDef>;

export type RuleId = keyof typeof RULES;

/** Oldest confirmation date in the registry — shown as "rules current as of". */
export const RULES_AS_OF: string = Object.values(RULES)
  .map((r) => r.asOf)
  .sort()[0]!;

/** Rule ids whose `reviewBy` has passed as of `on`. Surface these in CI. */
export function staleRules(on: Date): RuleId[] {
  return (Object.keys(RULES) as RuleId[]).filter((id) => {
    const by = (RULES[id] as RuleDef).reviewBy;
    return by !== undefined && new Date(by + 'T00:00:00Z') < on;
  });
}
