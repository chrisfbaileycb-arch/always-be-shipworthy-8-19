import { describe, expect, it } from 'vitest';
import { providersFor, selectedProviderNames, VESSEL_PROVIDERS } from './vessel-providers';

describe('vessel provider catalog', () => {
  it('offers several choices for every capability', () => {
    for (const capability of ['hosting', 'database', 'telemetry', 'uptime', 'repository', 'dns'] as const) {
      expect(providersFor(capability).length).toBeGreaterThanOrEqual(4);
    }
  });
  it('contains no ranking or commercial preference field', () => {
    const text = JSON.stringify(VESSEL_PROVIDERS).toLowerCase();
    for (const banned of ['recommended', 'preferred', 'sponsored', 'rank', 'price']) expect(text).not.toContain(banned);
  });
  it('resolves selections in catalog order', () => {
    expect(selectedProviderNames(['sentry-vessel', 'supabase'])).toEqual(['Supabase', 'Sentry']);
  });
});
