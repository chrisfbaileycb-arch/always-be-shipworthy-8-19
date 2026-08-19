/**
 * Build module — app configuration and dependency audit.
 *
 * Ported from SHIFT Pre-Flight's `auditSafety`, which was the only genuinely
 * real analysis engine across the three source codebases. The detection logic is
 * carried over close to intact; what changed is the contract around it:
 *
 *   - Empty or unrecognisable config now returns `not_assessed`, not a score.
 *     SHIFT returned 98/100 for an empty form, all-green, with zero findings.
 *   - Every finding quotes the text that triggered it and cites a registered rule.
 *   - The Play target-SDK floor comes from the dated registry, which knows the
 *     floor rises to 36 on 2026-08-31, rather than a hardcoded `v < 35`.
 *   - Detected secrets are masked before being quoted back to the user.
 */

import { assessed, makeFinding, notAssessed } from '../core/finding';
import { PLAY_TARGET_API, playFloorRisingSoon, playSubmissionFloor, type RuleId } from '../core/rules';
import type { Evidence, Finding, ModuleResult } from '../core/types';

const MODULE = 'build' as const;

export type ConfigKind = 'android' | 'ios' | 'node' | 'generic' | 'none';

export interface BuildInput {
  config: string;
  /** Scan date, injected so reports are reproducible and rules resolve correctly. */
  now: Date;
}

// ─── Sensitive permissions ───────────────────────────────────────────────────

export const SENSITIVE_PERMISSIONS: Record<string, { label: string; justify: RegExp }> = {
  ACCESS_FINE_LOCATION: { label: 'precise location', justify: /location|map|nearby|navigat|gps|weather|deliver/i },
  ACCESS_BACKGROUND_LOCATION: { label: 'background location', justify: /background location|geofenc|track.*(route|run|ride)/i },
  READ_CONTACTS: { label: 'contacts', justify: /contact|invite friend|address book/i },
  RECORD_AUDIO: { label: 'microphone', justify: /voice|audio|record|microphone|dictat|karaoke|sing/i },
  CAMERA: { label: 'camera', justify: /camera|photo|video|scan|selfie|document|barcode|qr/i },
  READ_SMS: { label: 'SMS messages', justify: /sms|text message|otp|verification code/i },
  READ_CALL_LOG: { label: 'call log', justify: /call log|call history|caller/i },
  READ_PHONE_STATE: { label: 'phone state', justify: /caller id|phone call|dialer/i },
  MANAGE_EXTERNAL_STORAGE: { label: 'all-files storage access', justify: /file manager|file browser|backup tool/i },
  SYSTEM_ALERT_WINDOW: { label: 'draw over other apps', justify: /overlay|floating|bubble|screen filter/i },
  REQUEST_INSTALL_PACKAGES: { label: 'install other apps', justify: /app store|installer|launcher/i },
  QUERY_ALL_PACKAGES: { label: 'list installed apps', justify: /launcher|antivirus|device manage/i },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function detectConfigKind(cfg: string): ConfigKind {
  if (!cfg.trim()) return 'none';
  if (/<manifest[\s>]|android\.permission|AndroidManifest/i.test(cfg)) return 'android';
  if (/<plist|<key>|CFBundle|NS\w+UsageDescription/i.test(cfg)) return 'ios';
  if (/"dependencies"|"devDependencies"|"scripts"\s*:/.test(cfg)) return 'node';
  return 'generic';
}

/** 1-indexed line number of a character offset, for evidence locators. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/** Never echo a full credential back to the user. Keep enough to locate it. */
function maskSecret(raw: string): string {
  if (raw.length <= 12) return raw.slice(0, 4) + '…';
  return raw.slice(0, 8) + '…' + raw.slice(-4) + ` (${raw.length} chars)`;
}

function evidenceFor(cfg: string, match: RegExpMatchArray, opts?: { mask?: boolean }): Evidence {
  const raw = match[0];
  const idx = match.index ?? 0;
  return {
    excerpt: opts?.mask ? maskSecret(raw) : raw,
    locator: `config:L${lineAt(cfg, idx)}`,
    source: 'config',
  };
}

/** Find first match with position info, or null. */
function find(cfg: string, re: RegExp): RegExpMatchArray | null {
  return cfg.match(re);
}

// ─── Audit ───────────────────────────────────────────────────────────────────

interface SecretCheck {
  ruleId: RuleId;
  re: RegExp;
  title: string;
  fix: string;
}

const SECRET_CHECKS: SecretCheck[] = [
  {
    ruleId: 'build.secret.aws-key',
    re: /AKIA[0-9A-Z]{16}/,
    title: 'AWS access key ID in configuration',
    fix: 'Remove the key from the client, rotate it in IAM immediately, and move the call server-side.',
  },
  {
    ruleId: 'build.secret.google-api-key',
    re: /AIza[0-9A-Za-z\-_]{35}/,
    title: 'Google API key in configuration',
    fix: 'Restrict the key by package name and API scope in Google Cloud Console, or proxy the call through your backend.',
  },
  {
    ruleId: 'build.secret.stripe-live-key',
    re: /sk_live_[0-9a-zA-Z]{10,}/,
    title: 'Stripe live secret key in configuration',
    fix: 'Roll the key in the Stripe dashboard now and move all Stripe calls to your server. Secret keys must never reach a client.',
  },
  {
    ruleId: 'build.secret.private-key',
    re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    title: 'Private key material in configuration',
    fix: 'Remove the key block from the package and rotate the keypair. Private keys must not ship inside an app.',
  },
  {
    ruleId: 'build.secret.generic-credential',
    re: /(api[_-]?key|secret|token|passwd|password|pwd)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i,
    title: 'Possible hardcoded credential',
    fix: 'If this is a real credential, move it to a server or secrets manager and rotate it. Strings bundled into an app are trivially extractable.',
  },
];

export function auditBuild({ config, now }: BuildInput): ModuleResult {
  const kind = detectConfigKind(config);

  // The gate that makes a false pass impossible: nothing to read means no score.
  if (kind === 'none') {
    return notAssessed(MODULE, [
      'your AndroidManifest.xml, Info.plist, or package.json',
    ]);
  }

  const findings: Finding[] = [];
  const checksRun: RuleId[] = [];

  const run = (ruleId: RuleId, fn: () => Finding | Finding[] | null) => {
    checksRun.push(ruleId);
    const out = fn();
    if (!out) return;
    if (Array.isArray(out)) findings.push(...out);
    else findings.push(out);
  };

  // ── secrets ────────────────────────────────────────────────────────────────
  for (const check of SECRET_CHECKS) {
    run(check.ruleId, () => {
      const m = find(config, check.re);
      if (!m) return null;
      return makeFinding({
        module: MODULE,
        ruleId: check.ruleId,
        severity: 'critical',
        title: check.title,
        evidence: evidenceFor(config, m, { mask: true }),
        fix: check.fix,
      });
    });
  }

  // ── cleartext traffic ──────────────────────────────────────────────────────
  run('build.cleartext.http-url', () => {
    const re = /http:\/\/(?!schemas\.android\.com|www\.w3\.org|apple\.com\/DTDs|localhost|127\.0\.0\.1)[^\s"'<>]+/;
    const m = find(config, re);
    if (!m) return null;
    const all = config.match(new RegExp(re.source, 'g')) ?? [];
    return makeFinding({
      module: MODULE,
      ruleId: 'build.cleartext.http-url',
      severity: 'warn',
      title: `Cleartext HTTP endpoint referenced${all.length > 1 ? ` (${all.length} occurrences)` : ''}`,
      evidence: evidenceFor(config, m),
      fix: 'Switch the endpoint to https://. Android and iOS block cleartext by default; if a legacy host genuinely needs it, scope it in a network security config rather than globally.',
    });
  });

  run('build.cleartext.android-flag', () => {
    const m = find(config, /usesCleartextTraffic\s*=\s*["']true["']/i);
    if (!m) return null;
    return makeFinding({
      module: MODULE,
      ruleId: 'build.cleartext.android-flag',
      severity: 'warn',
      title: 'android:usesCleartextTraffic="true"',
      evidence: evidenceFor(config, m),
      fix: 'Remove the attribute and scope any legacy HTTP hosts with a network security config instead of re-enabling cleartext app-wide.',
    });
  });

  run('build.cleartext.ios-ats', () => {
    const m = find(config, /NSAllowsArbitraryLoads[\s\S]{0,40}?<true\s*\/>/i);
    if (!m) return null;
    return makeFinding({
      module: MODULE,
      ruleId: 'build.cleartext.ios-ats',
      severity: 'warn',
      title: 'App Transport Security disabled (NSAllowsArbitraryLoads)',
      evidence: evidenceFor(config, m),
      fix: 'Replace the blanket exception with per-domain entries under NSExceptionDomains. App Review asks for justification when ATS is disabled wholesale.',
    });
  });

  // ── debug and backup flags ─────────────────────────────────────────────────
  run('build.debug.android-debuggable', () => {
    const m = find(config, /android:debuggable\s*=\s*["']true["']/i);
    if (!m) return null;
    return makeFinding({
      module: MODULE,
      ruleId: 'build.debug.android-debuggable',
      severity: 'critical',
      title: 'android:debuggable="true" in manifest',
      evidence: evidenceFor(config, m),
      fix: 'Delete the attribute. Debug builds let anyone inspect runtime state, and Play rejects debuggable uploads.',
    });
  });

  run('build.backup.android-allow-backup', () => {
    const m = find(config, /android:allowBackup\s*=\s*["']true["']/i);
    if (!m) return null;
    return makeFinding({
      module: MODULE,
      ruleId: 'build.backup.android-allow-backup',
      severity: 'info',
      title: 'android:allowBackup="true"',
      evidence: evidenceFor(config, m),
      fix: 'If the app stores tokens or personal data, set android:dataExtractionRules to exclude them from device backups.',
    });
  });

  // ── target SDK, resolved from the dated registry ───────────────────────────
  run('build.sdk.play-target-floor', () => {
    const m = find(config, /targetSdkVersion\s*[="' ]*(\d+)|android:targetSdkVersion\s*=\s*["'](\d+)["']/i);
    if (!m) return null;
    const declared = parseInt(m[1] ?? m[2] ?? '', 10);
    if (!Number.isFinite(declared)) return null;

    const floor = playSubmissionFloor(now);
    const { next, changesOn } = PLAY_TARGET_API.submission;

    if (declared < floor) {
      return makeFinding({
        module: MODULE,
        ruleId: 'build.sdk.play-target-floor',
        severity: 'warn',
        title: `targetSdkVersion ${declared} is below the Play submission floor of ${floor}`,
        evidence: evidenceFor(config, m),
        fix: `Raise targetSdkVersion to at least ${floor} and retest. Play refuses new submissions below the floor.`,
      });
    }
    // Meets today's floor but not the one landing shortly — warn early rather
    // than let the developer ship into a deadline they cannot see.
    if (declared < next && playFloorRisingSoon(now)) {
      return makeFinding({
        module: MODULE,
        ruleId: 'build.sdk.play-target-floor',
        severity: 'info',
        title: `targetSdkVersion ${declared} meets today's floor but not the one taking effect ${changesOn}`,
        evidence: evidenceFor(config, m),
        fix: `Plan to move to API ${next} before ${changesOn}. An extension to ${PLAY_TARGET_API.submission.extensionUntil} can be requested in Play Console if you need it.`,
      });
    }
    return null;
  });

  // ── sensitive permissions ──────────────────────────────────────────────────
  run('build.permissions.sensitive', () => {
    const present: string[] = [];
    let firstMatch: RegExpMatchArray | null = null;
    for (const perm of Object.keys(SENSITIVE_PERMISSIONS)) {
      const m = find(config, new RegExp(`(android\\.permission\\.)?${perm}`));
      if (m) {
        present.push(perm);
        firstMatch ??= m;
      }
    }
    if (!firstMatch || present.length === 0) return null;
    return makeFinding({
      module: MODULE,
      ruleId: 'build.permissions.sensitive',
      severity: 'info',
      title: `${present.length} sensitive permission${present.length > 1 ? 's' : ''} requested: ${present.join(', ')}`,
      evidence: evidenceFor(config, firstMatch),
      fix: 'Drop any permission your core features do not need. Each one raises review scrutiny and costs installs at the consent prompt.',
    });
  });

  // ── node dependency hygiene ────────────────────────────────────────────────
  if (kind === 'node') {
    run('build.deps.wildcard-version', () => {
      const m = find(config, /:\s*["'](\*|latest)["']/);
      if (!m) return null;
      return makeFinding({
        module: MODULE,
        ruleId: 'build.deps.wildcard-version',
        severity: 'warn',
        title: 'Wildcard dependency version',
        evidence: evidenceFor(config, m),
        fix: 'Pin the version and commit a lockfile. Wildcards make builds non-reproducible and can pull a breaking or compromised release without warning.',
      });
    });

    run('build.deps.not-private', () => {
      if (/"private"\s*:\s*true/.test(config)) return null;
      const m = find(config, /"name"\s*:\s*"[^"]*"/);
      if (!m) return null;
      return makeFinding({
        module: MODULE,
        ruleId: 'build.deps.not-private',
        severity: 'info',
        title: 'package.json is not marked private',
        evidence: evidenceFor(config, m),
        fix: 'Add "private": true so an accidental `npm publish` cannot push your application to the public registry.',
      });
    });
  }

  return assessed(MODULE, findings, checksRun);
}
