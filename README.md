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
src/App.tsx           Phase 1 demo surface
```

## Modules

| Module | Job | State |
|---|---|---|
| **Build** | Hardcoded keys, cleartext, debug flags, permissions, SDK floor | Working |
| **Listing** | Metadata limits, keyword stuffing, brand mentions, claims | Working |
| **Policy** | Privacy policy, platform billing, COPPA, permission purpose | Working |
| **Claims** | Are your marketing promises substantiable? | Phase 2 |
| **Name** | Trademark, domain, handle collision | Phase 3 |
| **Watch** | Post-launch alerts, telemetry, health | Phase 4 |

Build, Listing, and Policy are ported from SHIFT Pre-Flight, which held the only
genuinely real analysis engine across the three predecessor codebases. The
detection logic carried over close to intact; the contract around it did not.

## Develop

```bash
npm install
npm run dev        # demo UI at localhost:5173
npm test           # 47 tests
npm run typecheck  # strict, with noUncheckedIndexedAccess
npm run build
```

The scan runs entirely in the browser with no account and no network call.
Nothing is uploaded. That stays true for every deterministic check — only the
Claims module (Phase 2) will need a server, and its provider key goes in a
Supabase Edge Function, never the browser.

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

Phase 1. The engine, the contract, and the three ported modules are working and
tested. Still to come: Claims (Phase 2), a real Name module (Phase 3), Watch
(Phase 4), and Supabase auth and persistence.
