import { describe, expect, it } from 'vitest';
import { buildDiscernment, inspectSafety, toPlaywrightScript, toSkillMarkdown, type WorkflowInput } from './workflow';

const input: WorkflowInput = {
  title: 'Income tutorial', sourceKind: 'video', sourceUrl: 'https://example.com/tutorial', mode: 'evaluate-build',
  content: 'This is easy passive income and anyone can make $1,000 a day. 1. Choose a customer problem. 2. Visit the website and create one small test. 3. Record the result before expanding.',
};

describe('knowledge-to-execution engine', () => {
  it('does not turn an earnings claim into a truth verdict', () => {
    const report = buildDiscernment(input);
    expect(report.claims.some((claim) => claim.classification === 'Outcome appears atypical')).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/liar|scam|false claim/i);
  });

  it('blocks financial and credential-bearing workflows', () => {
    expect(inspectSafety('Open my bank account and enter the routing number.').allowed).toBe(false);
    expect(inspectSafety('Use this API key and session cookie to sign in.').allowed).toBe(false);
  });

  it('exports an inspectable skill and read-only Playwright scaffold', () => {
    const report = buildDiscernment(input);
    expect(toSkillMarkdown(input, report)).toContain('## Safety contract');
    expect(toPlaywrightScript(input, report)).toContain('Read-only scaffold');
  });

  it('refuses code export when the safety policy is triggered', () => {
    const unsafe = { ...input, content: 'Use my credit card to purchase advertising and then withdraw the money.' };
    expect(toPlaywrightScript(unsafe, buildDiscernment(unsafe))).toContain('Export blocked');
  });
});
