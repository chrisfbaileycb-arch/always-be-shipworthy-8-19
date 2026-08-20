import { describe, expect, it } from 'vitest';
import { PLANS } from './commerce';

describe('commercial plan registry', () => {
  it('keeps every public plan id and price unique', () => {
    expect(new Set(PLANS.map((plan) => plan.id)).size).toBe(4);
    expect(PLANS.map((plan) => plan.price)).toEqual(['$0', '$12', '$19', '$49']);
  });
  it('does not promise premium capability on the free plan', () => {
    const free = PLANS.find((plan) => plan.id === 'free');
    expect(free?.features.join(' ').toLowerCase()).not.toMatch(/claims|trademark|pdf/);
  });
});
