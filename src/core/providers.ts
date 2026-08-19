/**
 * Observability provider catalog.
 *
 * WHY THIS FILE EXISTS
 *
 * BrandGuard's pre-flight checklist hardcoded one vendor. Its "Production
 * Instrumentation" milestone was literally a Sentry setup script — go to
 * sentry.io, copy two DSNs, paste them into these two fields — and its data model
 * carried `sentry_dsn_frontend` and `sentry_dsn_backend` columns to match. That
 * was the right answer for the person who wrote it and the wrong default for
 * everyone else. A launch-readiness tool that only recognises one vendor reports
 * a false gap for every team using a different one, which is the same class of
 * error as a false pass: the tool is confidently wrong about the app.
 *
 * So: no vendor is privileged anywhere in this codebase. A finding names the
 * *capability* that is missing and offers the field. Ordering here is
 * alphabetical within a category, deliberately — there is no "recommended"
 * option, because we are not in a position to recommend one.
 *
 * WHAT IS RECORDED, AND WHAT IS NOT
 *
 * Only structural facts that stay true: package names, environment-variable
 * conventions, whether the thing can be self-hosted, and the docs URL. No
 * pricing, no free-tier limits, no "best for small teams" — those change
 * quarterly and would be stale advice inside a scanner whose entire pitch is
 * that its rules are dated and current.
 */

export type ProviderCategory = 'error-tracking' | 'uptime' | 'analytics' | 'logging';

export interface Provider {
  id: string;
  name: string;
  category: ProviderCategory;
  /** Package names that indicate this provider is installed. */
  packages: string[];
  /** Environment-variable name fragments that indicate it is configured. */
  envHints: string[];
  /** Can be run on your own infrastructure — matters for data-residency rules. */
  selfHostable: boolean;
  /** Open-source core. */
  openSource: boolean;
  docs: string;
}

export const PROVIDERS_AS_OF = '2026-08-19';

/**
 * Alphabetical within category. If you add one, add it in order and do not
 * introduce a "recommended" flag — the absence of one is the point.
 */
export const PROVIDERS: Provider[] = [
  // ── Error and crash reporting ──────────────────────────────────────────────
  {
    id: 'appsignal',
    name: 'AppSignal',
    category: 'error-tracking',
    packages: ['@appsignal/javascript', '@appsignal/nodejs', '@appsignal/react'],
    envHints: ['APPSIGNAL_PUSH_API_KEY', 'APPSIGNAL_API_KEY'],
    selfHostable: false,
    openSource: false,
    docs: 'https://docs.appsignal.com/',
  },
  {
    id: 'bugsnag',
    name: 'Bugsnag',
    category: 'error-tracking',
    packages: ['@bugsnag/js', '@bugsnag/react', '@bugsnag/expo'],
    envHints: ['BUGSNAG_API_KEY'],
    selfHostable: true,
    openSource: false,
    docs: 'https://docs.bugsnag.com/',
  },
  {
    id: 'datadog',
    name: 'Datadog',
    category: 'error-tracking',
    packages: ['@datadog/browser-rum', '@datadog/browser-logs', 'dd-trace'],
    envHints: ['DD_API_KEY', 'DATADOG_API_KEY', 'DD_CLIENT_TOKEN'],
    selfHostable: false,
    openSource: false,
    docs: 'https://docs.datadoghq.com/',
  },
  {
    id: 'glitchtip',
    name: 'GlitchTip',
    category: 'error-tracking',
    // Sentry-SDK compatible; distinguished by the DSN host, not the package.
    packages: ['@sentry/browser', '@sentry/node'],
    envHints: ['GLITCHTIP_DSN'],
    selfHostable: true,
    openSource: true,
    docs: 'https://glitchtip.com/documentation',
  },
  {
    id: 'highlight',
    name: 'Highlight.io',
    category: 'error-tracking',
    packages: ['highlight.run', '@highlight-run/node', '@highlight-run/react'],
    envHints: ['HIGHLIGHT_PROJECT_ID'],
    selfHostable: true,
    openSource: true,
    docs: 'https://www.highlight.io/docs',
  },
  {
    id: 'honeybadger',
    name: 'Honeybadger',
    category: 'error-tracking',
    packages: ['@honeybadger-io/js', '@honeybadger-io/react'],
    envHints: ['HONEYBADGER_API_KEY'],
    selfHostable: false,
    openSource: false,
    docs: 'https://docs.honeybadger.io/',
  },
  {
    id: 'newrelic',
    name: 'New Relic',
    category: 'error-tracking',
    packages: ['newrelic', '@newrelic/browser-agent'],
    envHints: ['NEW_RELIC_LICENSE_KEY', 'NEWRELIC_LICENSE_KEY'],
    selfHostable: false,
    openSource: false,
    docs: 'https://docs.newrelic.com/',
  },
  {
    id: 'openobserve',
    name: 'OpenObserve',
    category: 'error-tracking',
    packages: ['@openobserve/browser-rum', '@openobserve/browser-logs'],
    envHints: ['OPENOBSERVE_TOKEN', 'ZO_ROOT_USER_EMAIL'],
    selfHostable: true,
    openSource: true,
    docs: 'https://openobserve.ai/docs/',
  },
  {
    id: 'opentelemetry',
    name: 'OpenTelemetry (vendor-neutral)',
    category: 'error-tracking',
    packages: ['@opentelemetry/api', '@opentelemetry/sdk-node', '@opentelemetry/sdk-trace-web'],
    envHints: ['OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_SERVICE_NAME'],
    selfHostable: true,
    openSource: true,
    docs: 'https://opentelemetry.io/docs/',
  },
  {
    id: 'rollbar',
    name: 'Rollbar',
    category: 'error-tracking',
    packages: ['rollbar', '@rollbar/react'],
    envHints: ['ROLLBAR_ACCESS_TOKEN', 'ROLLBAR_TOKEN'],
    selfHostable: false,
    openSource: false,
    docs: 'https://docs.rollbar.com/',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'error-tracking',
    packages: [
      '@sentry/browser', '@sentry/node', '@sentry/react', '@sentry/react-native',
      '@sentry/nextjs', '@sentry/vue', '@sentry/deno', 'sentry-expo',
    ],
    envHints: ['SENTRY_DSN', 'SENTRY_AUTH_TOKEN'],
    selfHostable: true,
    openSource: true,
    docs: 'https://docs.sentry.io/',
  },

  // ── Uptime and availability ────────────────────────────────────────────────
  {
    id: 'betterstack',
    name: 'Better Stack',
    category: 'uptime',
    packages: [],
    envHints: ['BETTERSTACK_TOKEN', 'LOGTAIL_TOKEN'],
    selfHostable: false,
    openSource: false,
    docs: 'https://betterstack.com/docs/uptime/',
  },
  {
    id: 'checkly',
    name: 'Checkly',
    category: 'uptime',
    packages: ['checkly', '@checkly/cli'],
    envHints: ['CHECKLY_API_KEY'],
    selfHostable: false,
    openSource: false,
    docs: 'https://www.checklyhq.com/docs/',
  },
  {
    id: 'gatus',
    name: 'Gatus',
    category: 'uptime',
    packages: [],
    envHints: ['GATUS_CONFIG_PATH'],
    selfHostable: true,
    openSource: true,
    docs: 'https://gatus.io/docs',
  },
  {
    id: 'uptime-kuma',
    name: 'Uptime Kuma',
    category: 'uptime',
    packages: [],
    envHints: ['UPTIME_KUMA_URL'],
    selfHostable: true,
    openSource: true,
    docs: 'https://github.com/louislam/uptime-kuma/wiki',
  },
  {
    id: 'uptimerobot',
    name: 'UptimeRobot',
    category: 'uptime',
    packages: [],
    envHints: ['UPTIMEROBOT_API_KEY'],
    selfHostable: false,
    openSource: false,
    docs: 'https://uptimerobot.com/api/',
  },
];

export const CATEGORY_LABEL: Record<ProviderCategory, string> = {
  'error-tracking': 'error and crash reporting',
  uptime: 'uptime monitoring',
  analytics: 'product analytics',
  logging: 'log aggregation',
};

export function providersIn(category: ProviderCategory): Provider[] {
  return PROVIDERS.filter((p) => p.category === category);
}

/**
 * Options phrased as a menu, for a finding's `fix`.
 *
 * Self-hostable choices are marked because that is the one axis where the answer
 * is genuinely constrained rather than preference — a team with data-residency
 * obligations cannot pick a hosted-only vendor, and saying so is information
 * rather than a recommendation.
 */
export function describeOptions(category: ProviderCategory, limit = 6): string {
  const list = providersIn(category);
  const shown = list.slice(0, limit);
  const rendered = shown
    .map((p) => (p.selfHostable ? `${p.name} (self-hostable)` : p.name))
    .join(', ');
  const rest = list.length - shown.length;
  return rest > 0 ? `${rendered}, and ${rest} more` : rendered;
}

/** Every package name that indicates any provider in a category. */
export function packagesFor(category: ProviderCategory): Set<string> {
  const out = new Set<string>();
  for (const p of providersIn(category)) for (const pkg of p.packages) out.add(pkg);
  return out;
}

/** Providers whose package or env hint appears in the given text. */
export function detectProviders(text: string, category?: ProviderCategory): Provider[] {
  const pool = category ? providersIn(category) : PROVIDERS;
  const found: Provider[] = [];
  for (const p of pool) {
    const hit =
      p.packages.some((pkg) => text.includes(`"${pkg}"`) || text.includes(`'${pkg}'`)) ||
      p.envHints.some((env) => new RegExp(`\\b${env}\\b`).test(text));
    if (hit) found.push(p);
  }
  return found;
}
