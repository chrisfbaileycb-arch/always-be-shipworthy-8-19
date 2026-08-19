# Shipworthy

Launch-readiness checks for app developers. Audits your app configuration and
store listing before you submit, and tells you what will get you rejected.

**One rule governs the whole codebase:**

> Every finding must be grounded in a specific line from the source text or a
> named external standard. Ungrounded statements are not emitted.

That is not a slogan. It is enforced in `src/core/finding.ts`, and two structural
decisions make it hold:

1. **A finding cannot be built without evidence.** `makeFinding()` throws if the
   excerpt is empty, the locator is empty, or the rule id is not in the registry.
   It throws at runtime, not just at compile time, because findings will
   eventually arrive from a model and a type annotation does not survive
   `JSON.parse`.

2. **A module that was given nothing returns no score.** `ModuleResult` is a
   discriminated union where `not_assessed` has no `score` field at all — so
   "checked and clean" and "never checked" are different *types*, not different
   numbers.

## Why the second one matters

This project exists because of a specific bug in its predecessor.

SHIFT Pre-Flight scored each pillar starting at 100 and only ever subtracted, so
a thin input had nothing to subtract from. Running its own audit functions
against these exact inputs produced:

| Input | Safety | Legal | Marketing |
|---|---|---|---|
| Title only, `"PhotoVault Pro"` | 98 | 100 | 98 |
| Completely empty form | 98 | 100 | 96 |

All six numbers rendered green, with zero warnings. Paste nothing, get a clean
bill of health. SHIFT's own end-to-end test covered that path but asserted only
that findings rendered and nothing crashed — it never looked at the scores, so
the bug passed CI every time.

`src/core/report.test.ts` pins that behaviour permanently. If anyone
reintroduces a default-to-a-high-score path, those tests fail.

The same bug tried to come back one level up during development: an early
`summarise()` averaged the assessed modules and ignored the rest, which reported
a headline **100/100** for a submission where two of three modules had nothing to
read. An overall score is a claim about the whole app, so it is now withheld
entirely unless every module ran. Partial coverage gets per-module scores and a
`coverage` figure instead.

## Rules are dated, because they move

Every threshold lives in `src/core/rules.ts` and nowhere else. No check hardcodes
a number.

SHIFT carried its Google Play target-SDK floor as a literal inside a sentence —
`'…(API 35 as of Aug 2025, rising yearly)…'` — beside a bare `v < 35` comparison.
Confirmed against Play Console Help on 2026-08-19, that comparison was **twelve
days from being wrong**: the submission floor rises to API 36 on 2026-08-31, and
the real rule is not one number at all.

```ts
PLAY_TARGET_API = {
  submission: { current: 35, next: 36, changesOn: '2026-08-31', extensionUntil: '2026-11-01' },
  existingAppVisibility: 35,
  formFactor: { wearOs: 35, automotive: 35, tv: 34, xr: 34 },
}
```

So `playSubmissionFloor(date)` resolves the floor for the scan date, the build
module warns *early* when a target meets today's floor but not the one landing
soon, and `staleRules(date)` reports any registry entry whose `reviewBy` has
passed. Reports render "rules current as of …" so a reader can judge the advice.

## Layout

```
src/core/types.ts     Finding, ModuleResult, Evidence, RuleRef — the contract
src/core/rules.ts     every threshold and policy reference, each dated
src/core/finding.ts   makeFinding() / notAssessed() / assessed() — the enforcement
src/core/report.ts    scan orchestration, summary, JSON + Markdown export
src/modules/build.ts    config, secrets, permissions, SDK floor
src/modules/listing.ts  store metadata limits, stuffing, brand mentions
src/modules/policy.ts   privacy policy, billing, COPPA, permission justification
src/lib/env.ts        the client/server secret boundary, enforced
src/lib/supabase.ts   nullable client — null means local-only, not broken
src/lib/auth.ts       passwordless email sign-in
src/modules/claims.ts   claim substantiation — the quote-verification gate
src/lib/persistence.ts save/list/delete, with null `overall` preserved
src/ui/Account.tsx    sign-in bar and saved-scan list
src/App.tsx           Phase 1 demo surface
supabase/migrations/  schema, RLS policies, grants
supabase/functions/claims-analyze/   the model call — holds the key and the prompt
supabase/functions/_shared/claims-contract.ts  prompt, schema, quote matcher
```

## Modules

| Module | Job | State |
|---|---|---|
| **Build** | Hardcoded keys, cleartext, debug flags, permissions, SDK floor | Working |
| **Listing** | Metadata limits, keyword stuffing, brand mentions, claims | Working |
| **Policy** | Privacy policy, platform billing, COPPA, permission purpose | Working |
| **Claims** | Are your marketing promises substantiable? | Working |
| **Name** | Trademark, domain, handle collision | Phase 3 |
| **Watch** | Post-launch alerts, telemetry, health | Phase 4 |

Build, Listing, and Policy are ported from SHIFT Pre-Flight, which held the only
genuinely real analysis engine across the three predecessor codebases. The
detection logic carried over close to intact; the contract around it did not.

## Secrets: the one boundary that matters

Vite inlines every `VITE_`-prefixed variable into the production bundle as a
literal string. That prefix *is* the security boundary, and crossing it is a
one-character mistake. Three layers enforce it:

**1. Naming.** `checkClientEnv` refuses to start the app if any `VITE_` variable
name contains `SERVICE_ROLE`, `OPENAI`, `STRIPE_SECRET`, `DATABASE_URL`, and so on.

**2. Value shape.** It also refuses if a `VITE_` variable *holds* something that
looks like a secret — an OpenAI, Anthropic, Stripe, AWS, or Supabase secret key, a
Postgres URL, a private-key block — regardless of what the variable is called. The
error tells you to rotate the credential, not merely to move it, because by then
it is on someone's disk.

**3. Supabase keys are identified by what they are, not what they are named.**
Legacy keys are JWTs carrying a `role` claim and newer ones are prefixed; both are
decoded. Pasting the `service_role` key into `VITE_SUPABASE_ANON_KEY` looks
identical in a diff and would hand every visitor full read/write on every row,
because `service_role` bypasses RLS. That is a hard startup failure.

**And the build output is scanned.** `npm run verify` builds, then greps `dist/`
with those same patterns. This was validated by planting a fake
`sk_live_…` in a `VITE_` variable: the build succeeded and the gate caught it,
naming the file and the pattern.

The anon key is safe in the browser only because row-level security protects the
data behind it. `supabase/migrations/0001_init.sql` enables RLS on every table,
scopes every policy to `auth.uid()`, uses `WITH CHECK` so a client cannot write a
row claiming to belong to somebody else, and revokes all `anon` grants. Reports
have no `UPDATE` policy at all — they are an immutable audit trail.

Provider keys for Phase 2 go in Supabase Edge Function secrets
(`supabase secrets set ANTHROPIC_API_KEY=…`), never the bundle. WorkflowVerify
kept its OpenAI key in browser localStorage; its own README flagged that as a V1
shortcut. That shortcut is not carried forward.

## The Claims module, and trusting a model

Claims is the only module whose findings come from a model instead of a regex,
so it is where the evidence rule has to be enforced hardest. A fabricated quote
would otherwise pass through the same `makeFinding()` a real one does — which is
exactly how the predecessor came to display USPTO serial numbers for a registry
it never queried.

**The gate: every quote the model returns is looked up in the source text the
user submitted.** A quote that cannot be located is discarded and counted. The
excerpt stored on the finding is the *source's* wording, not the model's, so the
user reads back their own sentence character for character even when the model
straightened a quotation mark on the way through.

Only whitespace and the punctuation a model habitually "improves" (curly quotes,
em dashes, non-breaking spaces) are normalised for matching. Change a word and
the quote is dropped. `src/modules/claims.test.ts` feeds the gate deliberately
dishonest output and asserts it is thrown away.

Model findings are always `confidence: 'heuristic'`. A model is not an
authoritative source, and `'verified'` is reserved for a live registry lookup.

### Two cost tiers

Deterministic pre-checks run locally, free and signed-out, on absolute language
that is indefensible however good the app is — "unhackable", "we never collect
any data", "guaranteed", a dollar-per-month income figure. The model pass runs
server-side behind auth and a rate limit, and finds what a pattern cannot:
implied comparisons, unstated conditions, promises assembled across a sentence.

When both tiers flag the same sentence the score is charged once — deduplicated
by overlapping character span, not by matching excerpt strings. Two genuinely
different claims in one sentence ("100% secure" and "completely unhackable") stay
two findings.

### What the client may influence

The text to analyse. That is all.

The system prompt, model, schema, token ceiling, and effort level are fixed in
the Edge Function. A client that could supply a prompt could instruct the model
to fabricate findings or turn a spend-limited endpoint into a general-purpose
model proxy on our bill. The listing copy is passed inside a delimiter and
labelled as content to review, never as instructions.

The prompt is not shipped to the browser, and `npm run verify` asserts it: the
bundle is scanned for prompt fingerprints, so a future refactor that imports it
for convenience fails the build rather than publishing it.

### Cost control

`claim_rate_limit` is a `SECURITY DEFINER` function that counts a user's calls in
the last hour and day — 20/hour, 100/day by default. It lives in the database
because an in-memory counter resets on every Edge Function cold start. Usage rows
are inserted only by that definer function, so a client cannot forge or delete
its history to reset the limit, and usage is recorded only *after* a successful
call, so a provider outage does not burn quota.

### Deploying it

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy claims-analyze
supabase db push
```

The endpoint degrades honestly: with no key set it returns `not_configured`, and
the local pre-checks still run. Every failure mode has a stable machine-readable
code and a message safe to show a user — provider internals are logged, never
returned.

## Persistence is opt-in

The scan runs locally, with no account and no network call. Saving a report is an
explicit button, available only when signed in — so the privacy claim stays true
for the default path, and the moment it stops being true is a button the user
pressed. Detected credentials are masked before a finding is ever constructed, so
a stored excerpt holds a fingerprint rather than a usable secret.

The app runs fully without Supabase configured. Leave both `VITE_` variables blank
and it is local-only: scans work, sign-in and history are hidden. That is a
supported mode, not a degraded one.

## Setup

```bash
npm install
cp .env.example .env     # optional — blank runs local-only
npm run dev              # localhost:5173
```

To enable sign-in and history, create a Supabase project, put the URL and
**anon** key in `.env`, and apply the migration:

```bash
supabase db push          # or paste supabase/migrations/0001_init.sql into the SQL editor
```

Auth is passwordless email (magic link). Shipworthy never handles, hashes, or
stores a password.

```bash
npm test           # 83 tests
npm run typecheck  # strict, noUncheckedIndexedAccess
npm run verify     # build, then test — includes the bundle secret scan
```

## Adding a check

1. Add the rule to `RULES` in `src/core/rules.ts` with an `authority`, a `url`,
   and the `asOf` date you confirmed it. Add `reviewBy` if it is known to move.
2. In the module, call `run(ruleId, () => …)` so the rule lands in `checksRun`
   whether or not it fires.
3. Return `makeFinding({ … })` with an `evidence.excerpt` quoting the text that
   triggered it and an `evidence.locator` saying where. If you cannot produce
   evidence, you do not have a finding.
4. Never write a threshold inline. It belongs in the registry.

Two things the codebase will not accept: a finding without evidence, and a score
from a module that had nothing to read.

## Conventions

- **Findings name the pattern and the rule, never a legal conclusion.** "Third-party
  brand name in description" — not "trademark infringement". This is not legal advice
  and must not read as if it is.
- **`confidence: 'verified'` means a live authoritative source was queried this
  run.** Everything else is `'heuristic'`, and heuristic findings must not render
  registrant names, serial numbers, or anything else implying a record was
  retrieved. The predecessor product printed invented USPTO serial numbers from a
  hardcoded dictionary; that must not happen here.
- **Scan dates are injected, never read from the clock inside a rule**, so reports
  are reproducible.
- **Detected credentials are masked before display.** Never echo a secret back in full.

## Status

**Phases 0–2 complete.** Engine, evidence contract, four working modules,
Supabase auth, persistence with RLS, the secret-boundary guards, and the Claims
module with its quote-verification gate — 109 tests, strict typecheck, clean
build.

The Claims Edge Function has not yet been exercised against the live Anthropic
API — there is no key in the development environment. The contract, the
validators, and the gate are fully tested; the provider call itself needs one
real invocation to confirm.

Next: **Phase 3, a real Name module** — USPTO TSDR and RDAP, or heuristic-only
with every fabricated serial number stripped. Then Watch (Phase 4).
