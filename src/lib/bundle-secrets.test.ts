/**
 * Build-output leak gate.
 *
 * Everything above this file reasons about what *should* reach the browser.
 * This one checks what actually did, by scanning the built bundle on disk with
 * the same patterns `checkClientEnv` uses at boot. Reviewing a diff cannot catch
 * a secret inlined by Vite from a stray `.env` entry; reading the artifact can.
 *
 * Run `npm run verify` (build, then test) to exercise this. When `dist/` is
 * absent — the normal `npm test` case — it reports that it did not run rather
 * than passing silently, because a check that quietly skips is worse than one
 * that is absent.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECRET_VALUE_PATTERNS } from './env';

const DIST = join(process.cwd(), 'dist');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const TEXTUAL = /\.(js|mjs|cjs|css|html|json|map|txt|svg)$/i;

describe('built bundle contains no secrets', () => {
  it('scans dist/ with the same patterns the runtime env check uses', () => {
    if (!existsSync(DIST)) {
      console.info(
        '[shipworthy] bundle scan skipped: no dist/. Run `npm run verify` to build and scan.',
      );
      expect(SECRET_VALUE_PATTERNS.length).toBeGreaterThan(0);
      return;
    }

    const files = walk(DIST).filter((f) => TEXTUAL.test(f));
    expect(files.length).toBeGreaterThan(0);

    const leaks: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const { name, re } of SECRET_VALUE_PATTERNS) {
        // Fresh regex per file: several patterns are stateless, but a global
        // flag added later would otherwise carry lastIndex between files.
        const match = new RegExp(re.source, re.flags.replace('g', '')).exec(text);
        if (match) {
          leaks.push(
            `${file.replace(process.cwd() + '/', '')}: ${name} — ` +
              `"${match[0].slice(0, 12)}…" (rotate this credential immediately)`,
          );
        }
      }
    }

    expect(leaks, `Secrets found in build output:\n${leaks.join('\n')}`).toEqual([]);
  });

  it('does not ship the claims system prompt to the browser', () => {
    if (!existsSync(DIST)) return;
    // The prompt is the instruction channel for a paid endpoint. It lives in the
    // Edge Function; the client sends only text. Today tree-shaking keeps it out
    // because src/modules/claims.ts imports the validators and not the prompt —
    // a future refactor that imports it for convenience would silently publish
    // it, so assert rather than assume.
    const files = walk(DIST).filter((f) => TEXTUAL.test(f));
    const fingerprints = ['THE ONE ABSOLUTE RULE', 'WHAT COUNTS AS A CLAIM WORTH FLAGGING'];
    const leaks: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const fp of fingerprints) {
        if (text.includes(fp)) leaks.push(`${file.replace(process.cwd() + '/', '')}: "${fp}"`);
      }
    }
    expect(leaks, `Claims system prompt found in build output:\n${leaks.join('\n')}`).toEqual([]);
  });

  it('does not inline any variable whose name marks it server-side', () => {
    if (!existsSync(DIST)) return;
    const files = walk(DIST).filter((f) => TEXTUAL.test(f));
    const forbidden = /VITE_[A-Z_]*(SERVICE_ROLE|SERVICE_KEY|SECRET|OPENAI|ANTHROPIC|DATABASE_URL)/;
    const hits: string[] = [];
    for (const file of files) {
      // The env module names these deliberately; skip its own definitions.
      const text = readFileSync(file, 'utf8');
      const m = forbidden.exec(text);
      if (m) hits.push(`${file.replace(process.cwd() + '/', '')}: ${m[0]}`);
    }
    expect(hits, `Server-side variable names inlined into the bundle:\n${hits.join('\n')}`).toEqual(
      [],
    );
  });
});
