import { describe, expect, it } from 'vitest';
import { healthSummary, VESSEL_CHECKS, vesselMarkdown } from './vessel';

describe('continuous vessel', () => {
  it('keeps every unchecked signal unknown rather than green', () => {
    expect(healthSummary({})).toEqual({ green: 0, yellow: 0, red: 0, unknown: VESSEL_CHECKS.length });
  });

  it('summarises declared signals', () => {
    expect(healthSummary({ name: 'green', security: 'red', cloud: 'yellow' })).toEqual({ green: 1, yellow: 1, red: 1, unknown: VESSEL_CHECKS.length - 3 });
  });

  it('exports evidence and the safety boundary', () => {
    const output = vesselMarkdown('Bookkeeper in a Box', { security: 'yellow' }, ['Supabase', 'Sentry']);
    expect(output).toContain('# Bookkeeper in a Box — Continuous Vessel');
    expect(output).toContain('Status: YELLOW');
    expect(output).toContain('Evidence required');
    expect(output).toContain('- Supabase');
    expect(output).toContain('No credentials');
  });
});
