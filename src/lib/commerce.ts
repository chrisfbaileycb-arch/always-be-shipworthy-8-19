export type PlanId = 'free' | 'deep-review' | 'personal' | 'studio';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: readonly string[];
  badge?: string;
}

export const PLANS: readonly PlanDefinition[] = [
  { id: 'free', name: 'Free', price: '$0', cadence: 'forever', description: 'Use the local app-readiness scanner and explore sample analyses.', features: ['Local app audit', 'Evidence on every finding', 'Markdown and JSON reports'] },
  { id: 'deep-review', name: 'Deep Review', price: '$12', cadence: 'one time', description: 'Evaluate one video, webpage, transcript, or document.', features: ['Claims discernment', 'Risk and missing-context review', 'Low-risk test plan', 'PDF-ready report'] },
  { id: 'personal', name: 'Personal', price: '$19', cadence: 'per month', description: 'Turn useful material into repeatable workflows and portable skills.', features: ['Recurring deep reviews', 'Project history', 'Markdown skill export', 'Target adapters'], badge: 'Best place to start' },
  { id: 'studio', name: 'Studio', price: '$49', cadence: 'per month', description: 'Manage multiple apps and generate reviewed automation scaffolds.', features: ['Everything in Personal', 'Multi-app registry', 'Playwright scaffolds', 'Maintenance cadence'] },
] as const;

export interface CheckoutResult { mode: 'stripe' | 'sandbox'; plan: Exclude<PlanId, 'free'>; redirectUrl?: string; }

export async function beginCheckout(plan: Exclude<PlanId, 'free'>): Promise<CheckoutResult> {
  const endpoint = import.meta.env.VITE_STRIPE_CHECKOUT_ENDPOINT?.trim();
  if (!endpoint) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return { mode: 'sandbox', plan };
  }
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan }) });
  if (!response.ok) throw new Error('Checkout could not be started. Please try again.');
  const payload = (await response.json()) as { url?: unknown };
  if (typeof payload.url !== 'string' || !payload.url.startsWith('https://')) throw new Error('Checkout returned an invalid redirect.');
  return { mode: 'stripe', plan, redirectUrl: payload.url };
}
