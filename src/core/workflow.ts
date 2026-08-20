export type SourceKind = 'text' | 'webpage' | 'video' | 'document';
export type ProcessingMode = 'evaluate' | 'teach' | 'operationalize' | 'build-skill' | 'evaluate-build';
export type ActionType = 'browser_action' | 'api_action' | 'human_action' | 'decision_gate' | 'verification' | 'stop_condition';

export interface WorkflowInput { title: string; sourceKind: SourceKind; sourceUrl?: string; content: string; mode: ProcessingMode; }
export interface ClaimAssessment { quote: string; classification: 'Supported by supplied evidence' | 'Reasonable but unverified' | 'Missing material context' | 'Outcome appears atypical' | 'Unable to determine'; concern: string; }
export interface WorkflowStep { id: number; type: ActionType; title: string; instruction: string; requiresConfirmation: boolean; }
export interface SafetyResult { allowed: boolean; reasons: string[]; }
export interface DiscernmentReport {
  title: string; summary: string; evidenceSupport: number; executionCompleteness: number; accessibility: number; testability: number;
  riskLevel: 'Low' | 'Moderate' | 'High'; claims: ClaimAssessment[]; hiddenRequirements: string[]; experiment: string[]; workflow: WorkflowStep[]; safety: SafetyResult;
}

const prohibited = [
  { re: /\b(bank|brokerage|crypto(?:currency)? wallet|routing number|credit card|debit card)\b/i, reason: 'Financial-account access or payment data' },
  { re: /\b(password|api key|secret key|session cookie|authentication code|seed phrase|private key)\b/i, reason: 'Credentials or authentication secrets' },
  { re: /\b(send|transfer|withdraw|purchase|buy|refund|place a trade|trade stocks?)\b.{0,30}\b(money|funds?|crypto|stock|card|account|payment)\b/i, reason: 'A financial transaction or purchase' },
  { re: /\b(bypass|circumvent|evade)\b.{0,30}\b(login|authentication|paywall|access control|safeguard)\b/i, reason: 'Circumvention of access controls' },
  { re: /\b(steal|harvest|exfiltrate|scrape private|impersonate|spam)\b/i, reason: 'Deceptive, invasive, or abusive activity' },
  { re: /\b(delete|destroy|wipe)\b.{0,30}\b(account|records?|repository|database|customer data)\b/i, reason: 'Destructive external action' },
];

export function inspectSafety(text: string): SafetyResult {
  const reasons = prohibited.filter((item) => item.re.test(text)).map((item) => item.reason);
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)] };
}

const sentences = (text: string) => text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter((item) => item.length > 24);

export function buildDiscernment(input: WorkflowInput): DiscernmentReport {
  const all = sentences(input.content);
  const claimLike = all.filter((item) => /\b(\$\s?\d|guarantee|easy|fast|daily|weekly|monthly|best|proven|anyone|passive|risk[- ]?free|always|never|100%)\b/i.test(item));
  const claims = (claimLike.length ? claimLike : all.slice(0, 3)).slice(0, 6).map<ClaimAssessment>((quote) => {
    if (/\$\s?\d|\b\d[\d,]*\s*(?:a day|daily|monthly|per month)\b/i.test(quote)) return { quote, classification: 'Outcome appears atypical', concern: 'The source gives an earnings outcome without typical-results evidence.' };
    if (/\b(guarantee|risk[- ]?free|anyone|always|never|100%)\b/i.test(quote)) return { quote, classification: 'Missing material context', concern: 'Absolute language needs conditions, limitations, and evidence.' };
    if (/\b(easy|fast|passive|proven|best)\b/i.test(quote)) return { quote, classification: 'Reasonable but unverified', concern: 'The result may depend on experience, audience, timing, or omitted work.' };
    return { quote, classification: 'Unable to determine', concern: 'The supplied material does not include enough external evidence to verify this statement.' };
  });
  const earnings = claims.some((claim) => claim.classification === 'Outcome appears atypical');
  const absolutes = claims.some((claim) => claim.classification === 'Missing material context');
  const hasSteps = /(?:^|\n)\s*(?:\d+[.)]|step\s+\d+|[-*])\s+/im.test(input.content);
  const hasEvidence = /\b(source|study|data|case study|documentation|citation|according to)\b/i.test(input.content);
  const safety = inspectSafety(input.content);
  const evidenceSupport = Math.max(8, Math.min(92, 28 + (hasEvidence ? 32 : 0) - (earnings ? 14 : 0) - (absolutes ? 10 : 0)));
  const executionCompleteness = Math.max(15, Math.min(95, 35 + (hasSteps ? 38 : 0) + Math.min(20, all.length * 2)));
  const accessibility = Math.max(20, Math.min(90, 72 - (earnings ? 12 : 0) - (input.content.length > 9000 ? 6 : 0)));
  const testability = Math.max(20, Math.min(95, 78 - (safety.allowed ? 0 : 35) - (earnings ? 8 : 0)));
  const base = all.filter((item) => !claimLike.includes(item)).slice(0, 5);
  const instructions = base.length ? base : ['Define the intended result and identify the smallest observable outcome.', 'Gather the tools and source material required for a limited test.', 'Run one controlled test before expanding the workflow.'];
  const workflow = instructions.map<WorkflowStep>((instruction, index) => ({ id: index + 1, type: index === 0 ? 'human_action' : index === instructions.length - 1 ? 'verification' : /\b(open|visit|click|page|website|browser)\b/i.test(instruction) ? 'browser_action' : 'human_action', title: index === 0 ? 'Define the test' : index === instructions.length - 1 ? 'Verify the outcome' : `Execute step ${index + 1}`, instruction, requiresConfirmation: false }));
  workflow.push({ id: workflow.length + 1, type: 'stop_condition', title: 'Stop before escalation', instruction: 'Stop if the test requires sensitive data, financial-account access, a purchase, destructive action, or exceeds the user-approved time and budget.', requiresConfirmation: true });
  return {
    title: input.title.trim() || 'Untitled source',
    summary: claims.length ? 'The source contains useful operational ideas, but its strongest promises require context or independent evidence before they should guide a larger commitment.' : 'The source is primarily instructional. Its workflow can be tested, but the supplied material alone does not establish that every outcome will generalize.',
    evidenceSupport, executionCompleteness, accessibility, testability,
    riskLevel: !safety.allowed || earnings && absolutes ? 'High' : earnings || absolutes ? 'Moderate' : 'Low', claims,
    hiddenRequirements: ['Prior experience may be assumed but not stated.', 'Tool, platform, audience, and operating costs may be omitted.', 'Results can depend on timing, distribution, repetition, and existing reputation.'],
    experiment: ['Choose one measurable outcome.', 'Set a small user-approved time and test budget without connecting a financial account.', 'Perform only the minimum workflow needed to produce one result.', 'Record time, cost, output quality, and missing prerequisites.', 'Continue only if the evidence supports the next step.'],
    workflow, safety,
  };
}

export function toSkillMarkdown(input: WorkflowInput, report: DiscernmentReport): string {
  const out = [`# ${report.title}`, '', '> Generated by Shipworthy from user-supplied material. Review before use.', '', '## Purpose', '', report.summary, '', '## Source', '', `- Type: ${input.sourceKind}`, `- URL: ${input.sourceUrl || 'Not supplied'}`, '', '## Safety contract', ''];
  if (!report.safety.allowed) out.push('**EXPORT BLOCKED**', ...report.safety.reasons.map((reason) => `- ${reason}`));
  else out.push('- Never request credentials, payment details, financial-account access, or sensitive personal information.', '- Never purchase, transfer, publish, submit, or delete without visible user confirmation.', '- Stop when a requested action crosses these boundaries.');
  out.push('', '## Workflow', '');
  for (const step of report.workflow) out.push(`### ${step.id}. ${step.title}`, '', `- Action type: \`${step.type}\``, `- Confirmation: ${step.requiresConfirmation ? 'Required' : 'Not required'}`, `- Instruction: ${step.instruction}`, '');
  out.push('## Verification', '', ...report.experiment.map((item) => `- ${item}`));
  return out.join('\n');
}

export function toPlaywrightScript(input: WorkflowInput, report: DiscernmentReport): string {
  if (!report.safety.allowed) return '// Export blocked by Shipworthy safety policy.\n';
  const url = input.sourceUrl && /^https?:\/\//.test(input.sourceUrl) ? input.sourceUrl : 'https://example.com';
  const steps = report.workflow.filter((step) => step.type === 'browser_action');
  return [`import { test, expect } from '@playwright/test';`, '', `test('${report.title.replace(/'/g, "\\'")} — reviewed workflow', async ({ page }) => {`, `  await page.goto('${url.replace(/'/g, "\\'")}');`, `  // Read-only scaffold. No purchases, submissions, credentials, or destructive actions.`, ...steps.map((step) => `  // ${step.id}. ${step.instruction.replace(/\n/g, ' ')}`), `  await expect(page).toHaveURL(/.*/);`, `});`, ''].join('\n');
}
