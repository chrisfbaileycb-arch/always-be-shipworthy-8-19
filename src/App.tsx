/**
 * Phase 1 demo surface.
 *
 * Deliberately plain — the point of this screen is to prove the engine and the
 * evidence contract end to end, not to be the finished product UI. The one thing
 * it does take seriously is rendering `not_assessed` as visibly different from a
 * pass, because that distinction is the whole thesis and a UI that blurs it puts
 * the false-pass bug straight back.
 */

import { useState } from 'react';
import { runScan, summarise, toJSON, toMarkdown } from './core/report';
import { isAssessed, MODULE_LABEL, type Report, type Severity } from './core/types';
import { SAMPLE_ANDROID, SAMPLE_THIN } from './samples';

const SEV_COLOR: Record<Severity, string> = {
  critical: 'var(--critical)',
  warn: 'var(--warn)',
  info: 'var(--info)',
};

const card: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: 20,
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: 6,
};

const input: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  border: '1px solid var(--line)',
  borderRadius: 4,
  background: 'var(--bg)',
  color: 'var(--ink)',
  font: 'inherit',
};

export default function App() {
  const [appName, setAppName] = useState('');
  const [title, setTitle] = useState('');
  const [shortDescription, setShort] = useState('');
  const [description, setDescription] = useState('');
  const [config, setConfig] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const scan = () =>
    setReport(runScan({ appName, title, shortDescription, description, config }));

  const load = (s: typeof SAMPLE_ANDROID) => {
    setAppName(s.appName);
    setTitle(s.title);
    setShort(s.shortDescription);
    setDescription(s.description);
    setConfig(s.config);
    setReport(null);
  };

  const copy = async (kind: 'json' | 'markdown') => {
    if (!report) return;
    await navigator.clipboard.writeText(kind === 'json' ? toJSON(report) : toMarkdown(report));
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  };

  const summary = report ? summarise(report) : null;

  return (
    <div style={{ maxWidth: 940, margin: '0 auto', padding: '40px 24px 80px' }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 34, margin: '0 0 6px', letterSpacing: '-0.02em' }}>Shipworthy</h1>
        <p style={{ margin: 0, color: 'var(--ink-2)', maxWidth: '62ch' }}>
          Audits your app configuration and store listing before you submit. Every finding quotes the
          text that triggered it and cites the rule it touches. Runs entirely in your browser —
          nothing is uploaded.
        </p>
      </header>

      <section style={{ ...card, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          <button onClick={() => load(SAMPLE_ANDROID)} style={ghost}>Load flawed Android sample</button>
          <button onClick={() => load(SAMPLE_THIN)} style={ghost}>Load thin input</button>
          <button onClick={() => load({ appName: '', title: '', shortDescription: '', description: '', config: '' })} style={ghost}>Clear</button>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <div>
              <label style={label} htmlFor="name">App name</label>
              <input id="name" style={input} value={appName} onChange={(e) => setAppName(e.target.value)} />
            </div>
            <div>
              <label style={label} htmlFor="title">Store title</label>
              <input id="title" style={input} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <div>
            <label style={label} htmlFor="short">Short description</label>
            <input id="short" style={input} value={shortDescription} onChange={(e) => setShort(e.target.value)} />
          </div>
          <div>
            <label style={label} htmlFor="desc">Full store description</label>
            <textarea id="desc" style={{ ...input, minHeight: 110 }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label style={label} htmlFor="cfg">App configuration</label>
            <textarea
              id="cfg"
              className="mono"
              style={{ ...input, minHeight: 150, fontSize: 13 }}
              placeholder="AndroidManifest.xml, Info.plist, or package.json"
              value={config}
              onChange={(e) => setConfig(e.target.value)}
            />
            <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '6px 0 0' }}>
              Do not paste live production secrets. Detected credentials are masked before display,
              but the safest input is a redacted copy.
            </p>
          </div>
          <button onClick={scan} style={primary}>Run scan</button>
        </div>
      </section>

      {report && summary && (
        <section style={{ ...card }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>{report.appName}</h2>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              rules current as of {report.rulesAsOf}
            </span>
          </div>

          <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>
            {summary.overall === null ? (
              <strong>
                {summary.assessedCount === 0
                  ? 'Nothing could be assessed. See below for what to supply.'
                  : `No overall score — only ${summary.assessedCount} of ${summary.assessedCount + summary.notAssessedCount} modules could be assessed. Per-module results below.`}
              </strong>
            ) : (
              <>
                <strong>{summary.overall}/100</strong> · all {summary.assessedCount} modules assessed ·{' '}
                {summary.totalChecksRun} checks ran · {summary.findings.critical} critical,{' '}
                {summary.findings.warn} warning, {summary.findings.info} info
              </>
            )}
          </p>

          <div style={{ display: 'grid', gap: 14 }}>
            {report.modules.map((m) => (
              <div
                key={m.module}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 5,
                  padding: 16,
                  // A module with nothing to assess is hatched, never green.
                  background: isAssessed(m)
                    ? 'var(--surface)'
                    : 'repeating-linear-gradient(135deg, transparent 0 7px, rgba(116,136,134,0.12) 7px 14px)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                  <strong>{MODULE_LABEL[m.module]}</strong>
                  {isAssessed(m) ? (
                    <span className="mono" style={{ fontSize: 13 }}>
                      {m.score}/100 · {m.checksRun.length} checks
                    </span>
                  ) : (
                    <span className="mono" style={{ fontSize: 11, color: 'var(--none)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      Not assessed
                    </span>
                  )}
                </div>

                {!isAssessed(m) && (
                  <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--ink-2)' }}>
                    No score produced — this is not a pass. To check this, supply {m.missing.join('; ')}.
                  </p>
                )}

                {isAssessed(m) && m.findings.length === 0 && (
                  <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--ink-2)' }}>
                    {m.checksRun.length} checks ran and found nothing.
                  </p>
                )}

                {isAssessed(m) &&
                  m.findings.map((f) => (
                    <div key={f.id} style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span
                          className="mono"
                          style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: SEV_COLOR[f.severity], border: `1px solid ${SEV_COLOR[f.severity]}`, borderRadius: 2, padding: '1px 5px' }}
                        >
                          {f.severity}
                        </span>
                        <strong style={{ fontSize: 15 }}>{f.title}</strong>
                      </div>
                      <div className="mono" style={{ fontSize: 12, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 3, padding: '7px 9px', margin: '9px 0', overflowX: 'auto' }}>
                        <span style={{ color: 'var(--ink-3)' }}>{f.evidence.locator} → </span>
                        {f.evidence.excerpt}
                      </div>
                      <p style={{ margin: '0 0 6px', fontSize: 14, color: 'var(--ink-2)' }}>{f.fix}</p>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>
                        <a href={f.rule.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                          {f.rule.id}
                        </a>{' '}
                        · {f.rule.authority} · confirmed {f.rule.asOf} · {f.confidence}
                      </p>
                    </div>
                  ))}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
            <button onClick={() => copy('markdown')} style={ghost}>
              {copied === 'markdown' ? 'Copied' : 'Copy as Markdown'}
            </button>
            <button onClick={() => copy('json')} style={ghost}>
              {copied === 'json' ? 'Copied' : 'Copy as JSON'}
            </button>
          </div>

          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 18, marginBottom: 0 }}>
            Automated analysis of the material provided. Not legal advice, not a security audit, and
            not a guarantee of store approval. Every finding cites the text that triggered it and the
            rule it touches — verify both before acting.
          </p>
        </section>
      )}
    </div>
  );
}

const ghost: React.CSSProperties = {
  padding: '7px 13px',
  border: '1px solid var(--line)',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--ink-2)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 13,
};

const primary: React.CSSProperties = {
  padding: '11px 18px',
  border: 0,
  borderRadius: 5,
  background: 'var(--accent)',
  color: '#fff',
  cursor: 'pointer',
  font: 'inherit',
  fontWeight: 600,
};
