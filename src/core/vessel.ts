export type HealthStatus = 'green' | 'yellow' | 'red' | 'unknown';
export type AuditCadence = 'Pre-live' | 'Weekly' | 'Monthly' | 'Quarterly';

export interface VesselCheck {
  id: string;
  group: 'Identity' | 'Security & trust' | 'Infrastructure' | 'Product & growth' | 'Engineering & scale';
  title: string;
  cadence: AuditCadence;
  evidence: string;
  remediation: string;
}

export const VESSEL_CHECKS: VesselCheck[] = [
  { id: 'name', group: 'Identity', title: 'Trademark & business name', cadence: 'Pre-live', evidence: 'Search sources, candidate classes, domains, and counsel notes', remediation: 'Open the name review and resolve conflicts before launch.' },
  { id: 'integrations', group: 'Infrastructure', title: 'Third-party integrations', cadence: 'Pre-live', evidence: 'Redacted configuration, test responses, and least-privilege scopes', remediation: 'Re-test the failing integration with non-production credentials.' },
  { id: 'cloud', group: 'Infrastructure', title: 'Cloud configuration & cost risk', cadence: 'Monthly', evidence: 'Provider health, latency, usage limits, and billing alerts', remediation: 'Review avoidable cost and performance risks; no savings are guaranteed.' },
  { id: 'security', group: 'Security & trust', title: 'Application security', cadence: 'Weekly', evidence: 'Authenticated test results, input boundaries, and security findings', remediation: 'Contain critical exposure, preserve evidence, and require human approval before patching production.' },
  { id: 'identity', group: 'Security & trust', title: 'Identity & access', cadence: 'Monthly', evidence: 'Auth flows, RLS/permission rules, and role matrix', remediation: 'Correct least-privilege rules and re-run access tests.' },
  { id: 'supply-chain', group: 'Security & trust', title: 'Dependency & supply chain', cadence: 'Quarterly', evidence: 'Lockfile, advisories, licenses, and provenance', remediation: 'Upgrade or replace risky packages in a tested branch.' },
  { id: 'legal-data', group: 'Security & trust', title: 'Legal, privacy & data handling', cadence: 'Quarterly', evidence: 'Terms, licenses, disclosures, retention, and deletion behavior', remediation: 'Route legal or tax conclusions to qualified human review.' },
  { id: 'billing', group: 'Product & growth', title: 'Billing & entitlement flow', cadence: 'Pre-live', evidence: 'Sandbox receipts, webhook events, refunds, and access transitions', remediation: 'Keep live charges disabled until the full sandbox path passes.' },
  { id: 'copy', group: 'Product & growth', title: 'Copy, claims & discoverability', cadence: 'Quarterly', evidence: 'Landing copy, substantiation, metadata, and share previews', remediation: 'Replace vague or unsupported claims with evidence-backed language.' },
  { id: 'design', group: 'Product & growth', title: 'Design, mobile & tablet', cadence: 'Pre-live', evidence: 'Viewport captures, interaction checks, and consistency review', remediation: 'Fix blocking responsive or interaction defects before release.' },
  { id: 'performance', group: 'Engineering & scale', title: 'Performance', cadence: 'Monthly', evidence: 'Measured page, API, and database timings', remediation: 'Profile the measured bottleneck before changing architecture.' },
  { id: 'quality', group: 'Engineering & scale', title: 'Code quality & functional integrity', cadence: 'Pre-live', evidence: 'Build, typecheck, unit tests, and maintainability review', remediation: 'Repair failed contracts or regressions in a reviewable branch.' },
  { id: 'accessibility', group: 'Engineering & scale', title: 'Accessibility', cadence: 'Quarterly', evidence: 'Keyboard, screen-reader, contrast, and semantic checks', remediation: 'Resolve barriers and verify with both automation and human testing.' },
  { id: 'reliability', group: 'Engineering & scale', title: 'Scalability, reliability & error handling', cadence: 'Monthly', evidence: 'Load assumptions, retries, recovery paths, and error telemetry', remediation: 'Add bounded recovery behavior and validate failure paths.' },
  { id: 'database', group: 'Engineering & scale', title: 'Database integrity', cadence: 'Monthly', evidence: 'Schema, migrations, RLS, backups, latency, and connection health', remediation: 'Test migrations and recovery without exposing connection secrets.' },
  { id: 'docs', group: 'Engineering & scale', title: 'Documentation', cadence: 'Quarterly', evidence: 'Setup, user help, incident notes, and operating procedures', remediation: 'Update the exact workflow users or operators cannot complete.' },
];

export function healthSummary(statuses: Record<string, HealthStatus>) {
  const values = VESSEL_CHECKS.map((check) => statuses[check.id] ?? 'unknown');
  return {
    green: values.filter((value) => value === 'green').length,
    yellow: values.filter((value) => value === 'yellow').length,
    red: values.filter((value) => value === 'red').length,
    unknown: values.filter((value) => value === 'unknown').length,
  };
}

export function vesselMarkdown(project: string, statuses: Record<string, HealthStatus>, providers: string[] = []): string {
  const lines = [`# ${project || 'Untitled project'} — Continuous Vessel`, '', '> Statuses are user-declared unless a connected evidence source says otherwise.', ''];
  lines.push('## Selected stack', ...(providers.length ? providers.map((provider) => `- ${provider}`) : ['- No providers declared']), '');
  for (const check of VESSEL_CHECKS) {
    lines.push(`## ${check.title}`, `- Status: ${(statuses[check.id] ?? 'unknown').toUpperCase()}`, `- Cadence: ${check.cadence}`, `- Evidence required: ${check.evidence}`, `- Next action: ${check.remediation}`, '');
  }
  lines.push('## Safety boundary', 'No credentials, payment details, private customer data, or destructive production actions belong in this export.');
  return lines.join('\n');
}
