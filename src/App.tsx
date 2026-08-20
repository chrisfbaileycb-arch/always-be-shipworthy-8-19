import { useState } from 'react';
import { runScan, summarise, toJSON, toMarkdown } from './core/report';
import { isAssessed, MODULE_LABEL, type Report, type Severity } from './core/types';
import { beginCheckout, PLANS, type PlanDefinition } from './lib/commerce';
import { SAMPLE_ANDROID, SAMPLE_THIN } from './samples';

const premiumTools = [
  { icon: '✦', title: 'AI Claims Analysis', detail: 'Review marketing promises for substantiation risk.', tier: 'Launch · Pro · Agency' },
  { icon: '⌕', title: 'Trademark & Domain Check', detail: 'Query USPTO and authoritative RDAP sources.', tier: 'Launch · Pro · Agency' },
  { icon: '⇩', title: 'PDF Report Export', detail: 'Create a client-ready launch record.', tier: 'Launch · Agency' },
];
const severityColor: Record<Severity, string> = { critical: 'var(--critical)', warn: 'var(--warn)', info: 'var(--info)' };

export default function App() {
  const [appName, setAppName] = useState('');
  const [title, setTitle] = useState('');
  const [shortDescription, setShort] = useState('');
  const [description, setDescription] = useState('');
  const [config, setConfig] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<PlanDefinition | null>(null);
  const [checkoutState, setCheckoutState] = useState<'idle' | 'loading' | 'sandbox' | 'error'>('idle');

  const load = (sample: typeof SAMPLE_ANDROID) => {
    setAppName(sample.appName); setTitle(sample.title); setShort(sample.shortDescription);
    setDescription(sample.description); setConfig(sample.config); setReport(null);
  };
  const scan = () => {
    setReport(runScan({ appName, title, shortDescription, description, config }));
    requestAnimationFrame(() => document.querySelector('#results')?.scrollIntoView({ behavior: 'smooth' }));
  };
  const copy = async (kind: 'json' | 'markdown') => {
    if (!report) return;
    await navigator.clipboard.writeText(kind === 'json' ? toJSON(report) : toMarkdown(report));
    setCopied(kind); setTimeout(() => setCopied(null), 1800);
  };
  const choosePlan = async (plan: PlanDefinition) => {
    if (plan.id === 'free') { document.querySelector('#audit')?.scrollIntoView({ behavior: 'smooth' }); return; }
    setCheckoutPlan(plan); setCheckoutState('loading');
    try {
      const result = await beginCheckout(plan.id);
      if (result.mode === 'stripe' && result.redirectUrl) window.location.assign(result.redirectUrl);
      else setCheckoutState('sandbox');
    } catch { setCheckoutState('error'); }
  };
  const summary = report ? summarise(report) : null;

  return <div className="app-shell">
    <nav className="topbar"><a className="brand" href="#top"><span className="brand-mark">S</span> Shipworthy</a><div className="nav-actions"><a href="#plans">Pricing</a><a href="#audit">New audit</a></div></nav>
    <main id="top">
      <section className="hero">
        <div className="eyebrow"><span className="status-dot" /> App-store launch intelligence</div>
        <h1>Know what can block your launch <em>before review does.</em></h1>
        <p>Evidence-backed checks for configuration, store metadata, policy risk, marketing claims, naming conflicts, and production readiness.</p>
        <div className="hero-actions"><a className="button primary" href="#audit">Run a free audit</a><a className="button secondary" href="#plans">See premium plans</a></div>
        <div className="trust-row"><span>✓ Runs locally</span><span>✓ Evidence on every finding</span><span>✓ Rules dated and sourced</span></div>
      </section>

      <section id="audit" className="panel audit-panel">
        <div className="section-heading"><div><span className="kicker">Free audit workspace</span><h2>Submission readiness scan</h2><p>Paste a redacted listing and configuration. Four local assessments unlock instantly.</p></div><span className="tier-badge free">Free · unlocked</span></div>
        <div className="sample-row"><button onClick={() => load(SAMPLE_ANDROID)}>Load flawed Android sample</button><button onClick={() => load(SAMPLE_THIN)}>Load thin input</button><button onClick={() => load({ appName: '', title: '', shortDescription: '', description: '', config: '' })}>Clear</button></div>
        <div className="form-grid">
          <Field label="App name"><input value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="Your app" /></Field>
          <Field label="Store title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title shown in the store" /></Field>
          <Field label="Short description" wide><input value={shortDescription} onChange={(e) => setShort(e.target.value)} placeholder="Your store subtitle or short description" /></Field>
          <Field label="Full store description" wide><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Paste the complete listing copy" /></Field>
          <Field label="App configuration" wide><textarea className="mono" value={config} onChange={(e) => setConfig(e.target.value)} placeholder="AndroidManifest.xml, Info.plist, or package.json" /><small>Use a redacted copy. Never paste a live production secret.</small></Field>
        </div>
        <button className="button primary run-button" onClick={scan}>Run free audit <span>→</span></button>
      </section>

      {report && summary && <section id="results" className="results-section">
        <div className="section-heading"><div><span className="kicker">Audit results</span><h2>{report.appName}</h2><p>{summary.totalChecksRun} checks completed · rules current as of {report.rulesAsOf}</p></div><div className="score-orbit"><strong>{summary.overall ?? Math.round(summary.coverage * 100)}</strong><span>{summary.overall === null ? '% coverage' : '/100'}</span></div></div>
        {summary.overall === null && <div className="notice">No overall score was issued because some modules lacked enough input. Missing coverage is never treated as a pass.</div>}
        <div className="results-grid">{report.modules.map((module) => <article className="result-card" key={module.module}>
          <div className="card-top"><div><span className="tier-badge free">Unlocked</span><h3>{MODULE_LABEL[module.module]}</h3></div>{isAssessed(module) ? <strong className="module-score">{module.score}</strong> : <span className="not-assessed">Not assessed</span>}</div>
          {!isAssessed(module) ? <p>Supply {module.missing.join('; ')} to assess this area.</p> : module.findings.length === 0 ? <p>{module.checksRun.length} checks ran with no findings.</p> : <div className="finding-list">{module.findings.map((finding) => <div className="finding" key={finding.id}><span style={{ color: severityColor[finding.severity] }}>{finding.severity}</span><strong>{finding.title}</strong><p><code>{finding.evidence.excerpt}</code></p><small>{finding.fix}</small></div>)}</div>}
        </article>)}</div>
        <div className="export-row"><button onClick={() => copy('markdown')}>{copied === 'markdown' ? 'Copied' : 'Copy Markdown'}</button><button onClick={() => copy('json')}>{copied === 'json' ? 'Copied' : 'Copy JSON'}</button></div>
      </section>}

      <section className="premium-section">
        <div className="section-heading"><div><span className="kicker">Premium intelligence</span><h2>Go beyond the local scan</h2><p>Live and AI-assisted checks are clearly separated from the free audit.</p></div><span className="tier-badge premium">Premium</span></div>
        <div className="premium-grid">{premiumTools.map((tool) => <article className="premium-card" key={tool.title}><span className="premium-icon">{tool.icon}</span><span className="tier-badge locked">Locked</span><h3>{tool.title}</h3><p>{tool.detail}</p><small>{tool.tier}</small><button onClick={() => void choosePlan(PLANS[2]!)}>Upgrade to unlock</button></article>)}</div>
      </section>

      <section id="plans" className="plans-section">
        <div className="center-heading"><span className="kicker">Straightforward pricing</span><h2>Choose the protection your launch needs</h2><p>Start free. Upgrade only when live checks, history, or client-ready reporting earn their keep.</p></div>
        <div className="plans-grid">{PLANS.map((plan) => <article className={`plan-card ${plan.badge ? 'featured' : ''}`} key={plan.id}>{plan.badge && <span className="plan-ribbon">{plan.badge}</span>}<h3>{plan.name}</h3><div className="price"><strong>{plan.price}</strong><span>{plan.cadence}</span></div><p>{plan.description}</p><ul>{plan.features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul><button className={`button ${plan.badge ? 'primary' : 'secondary'}`} onClick={() => void choosePlan(plan)}>{plan.id === 'free' ? 'Start free' : `Choose ${plan.name}`}</button></article>)}</div>
        <p className="sandbox-note">Checkout is in demonstration mode until the Stripe endpoint is connected. No payment is taken in sandbox mode.</p>
      </section>
    </main>
    <footer><span>Shipworthy</span><p>Automated launch guidance—not legal advice, a security audit, or a guarantee of store approval.</p></footer>
    {checkoutPlan && <div className="modal-backdrop" role="presentation" onMouseDown={() => checkoutState !== 'loading' && setCheckoutPlan(null)}><div className="checkout-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setCheckoutPlan(null)}>×</button><span className="kicker">Secure checkout</span><h2>{checkoutPlan.name}</h2><div className="checkout-price">{checkoutPlan.price} <small>{checkoutPlan.cadence}</small></div>{checkoutState === 'loading' && <p>Preparing checkout…</p>}{checkoutState === 'sandbox' && <><div className="sandbox-success">✓ Sandbox checkout completed</div><p>This demonstrates the entitlement handoff. Connect the server-side Stripe endpoint to accept a real payment.</p><button className="button primary" onClick={() => setCheckoutPlan(null)}>Continue with demo access</button></>}{checkoutState === 'error' && <><p className="error-text">Checkout could not be started.</p><button className="button secondary" onClick={() => void choosePlan(checkoutPlan)}>Try again</button></>}</div></div>}
  </div>;
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}</span>{children}</label>;
}
