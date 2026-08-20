export type PlanId = 'free' | 'launch' | 'pro' | 'agency';

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
  { id: 'free', name: 'Free', price: '$0', cadence: 'forever', description: 'Run the standard scanner locally and keep a basic audit report.', features: ['Build configuration', 'Store listing', 'Policy review', 'Watch readiness'] },
  { id: 'launch', name: 'Single Launch Report', price: '$19', cadence: 'one time', description: 'One complete launch-readiness report for a single app submission.', features: ['Everything in Free', 'AI claims analysis', 'Name checks', 'PDF export'] },
  { id: 'pro', name: 'Developer Pro', price: '$29', cadence: 'per month', description: 'Ongoing protection for independent developers shipping repeatedly.', features: ['Report history', 'AI claims analysis', 'Trademark and domain checks', 'Priority rule updates'], badge: 'Most popular' },
  { id: 'agency', name: 'Agency Hub', price: '$79', cadence: 'per month', description: 'A multi-app workspace for teams managing client submissions.', features: ['Everything in Pro', 'Multi-app management', 'PDF exports', 'Client-ready reports'] },
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
