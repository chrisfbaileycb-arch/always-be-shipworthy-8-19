export type VesselCapability = 'hosting' | 'database' | 'telemetry' | 'uptime' | 'repository' | 'dns';

export interface VesselProvider {
  id: string;
  name: string;
  capability: VesselCapability;
  connection: 'api' | 'configuration' | 'manual';
}

export const VESSEL_CAPABILITY_LABEL: Record<VesselCapability, string> = {
  hosting: 'Hosting & runtime', database: 'Database & backend', telemetry: 'Errors & telemetry',
  uptime: 'Uptime monitoring', repository: 'Source repository', dns: 'Domain & DNS',
};

/** Alphabetical within each capability. No provider receives a product-truth advantage. */
export const VESSEL_PROVIDERS: VesselProvider[] = [
  { id: 'cloudflare-pages', name: 'Cloudflare Pages', capability: 'hosting', connection: 'api' },
  { id: 'fly', name: 'Fly.io', capability: 'hosting', connection: 'api' },
  { id: 'hostinger', name: 'Hostinger', capability: 'hosting', connection: 'manual' },
  { id: 'netlify', name: 'Netlify', capability: 'hosting', connection: 'api' },
  { id: 'railway-hosting', name: 'Railway', capability: 'hosting', connection: 'api' },
  { id: 'render', name: 'Render', capability: 'hosting', connection: 'api' },
  { id: 'self-hosted', name: 'Self-hosted / custom', capability: 'hosting', connection: 'manual' },
  { id: 'vercel', name: 'Vercel', capability: 'hosting', connection: 'api' },
  { id: 'firebase', name: 'Firebase', capability: 'database', connection: 'api' },
  { id: 'neon', name: 'Neon', capability: 'database', connection: 'api' },
  { id: 'planetscale', name: 'PlanetScale', capability: 'database', connection: 'api' },
  { id: 'railway-database', name: 'Railway', capability: 'database', connection: 'api' },
  { id: 'custom-database', name: 'Self-hosted / custom', capability: 'database', connection: 'manual' },
  { id: 'supabase', name: 'Supabase', capability: 'database', connection: 'api' },
  { id: 'appsignal-vessel', name: 'AppSignal', capability: 'telemetry', connection: 'api' },
  { id: 'bugsnag-vessel', name: 'Bugsnag', capability: 'telemetry', connection: 'api' },
  { id: 'datadog-vessel', name: 'Datadog', capability: 'telemetry', connection: 'api' },
  { id: 'highlight-vessel', name: 'Highlight.io', capability: 'telemetry', connection: 'api' },
  { id: 'opentelemetry-vessel', name: 'OpenTelemetry / custom', capability: 'telemetry', connection: 'configuration' },
  { id: 'rollbar-vessel', name: 'Rollbar', capability: 'telemetry', connection: 'api' },
  { id: 'sentry-vessel', name: 'Sentry', capability: 'telemetry', connection: 'api' },
  { id: 'betterstack-vessel', name: 'Better Stack', capability: 'uptime', connection: 'api' },
  { id: 'checkly-vessel', name: 'Checkly', capability: 'uptime', connection: 'api' },
  { id: 'uptime-kuma-vessel', name: 'Uptime Kuma / custom', capability: 'uptime', connection: 'configuration' },
  { id: 'uptimerobot-vessel', name: 'UptimeRobot', capability: 'uptime', connection: 'api' },
  { id: 'bitbucket', name: 'Bitbucket', capability: 'repository', connection: 'api' },
  { id: 'github', name: 'GitHub', capability: 'repository', connection: 'api' },
  { id: 'gitlab', name: 'GitLab', capability: 'repository', connection: 'api' },
  { id: 'custom-repository', name: 'Other / local repository', capability: 'repository', connection: 'manual' },
  { id: 'cloudflare-dns', name: 'Cloudflare', capability: 'dns', connection: 'api' },
  { id: 'godaddy', name: 'GoDaddy', capability: 'dns', connection: 'api' },
  { id: 'hostinger-dns', name: 'Hostinger', capability: 'dns', connection: 'manual' },
  { id: 'namecheap', name: 'Namecheap', capability: 'dns', connection: 'api' },
  { id: 'custom-dns', name: 'Other / custom DNS', capability: 'dns', connection: 'manual' },
];

export function providersFor(capability: VesselCapability): VesselProvider[] {
  return VESSEL_PROVIDERS.filter((provider) => provider.capability === capability);
}

export function selectedProviderNames(ids: string[]): string[] {
  const selected = new Set(ids);
  return VESSEL_PROVIDERS.filter((provider) => selected.has(provider.id)).map((provider) => provider.name);
}
