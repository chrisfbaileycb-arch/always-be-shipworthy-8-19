/**
 * Account bar and saved-report list.
 *
 * Both render nothing at all when Supabase is unconfigured. A sign-in button
 * that cannot work is worse than no button, and local-only is a supported way to
 * run this app rather than a broken one.
 */

import { useCallback, useEffect, useState } from 'react';
import { sendMagicLink, signOut, useAuth } from '../lib/auth';
import { deleteReport, listReports, rowHasOverall, type ReportRow } from '../lib/persistence';
import { isBackendConfigured } from '../lib/supabase';

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

const field: React.CSSProperties = {
  padding: '7px 10px',
  border: '1px solid var(--line)',
  borderRadius: 4,
  background: 'var(--bg)',
  color: 'var(--ink)',
  font: 'inherit',
  fontSize: 13,
  minWidth: 210,
};

export function AuthBar() {
  const { user, loading, available } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!available) {
    return (
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
        local-only · no backend configured
      </span>
    );
  }
  if (loading) return <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>…</span>;

  if (user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{user.email}</span>
        <button style={ghost} onClick={() => void signOut()}>Sign out</button>
      </div>
    );
  }

  const send = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await sendMagicLink(email);
      setStatus(`Sign-in link sent to ${email.trim()}. Check your inbox.`);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input
        style={field}
        type="email"
        value={email}
        placeholder="you@example.com"
        aria-label="Email address for sign-in link"
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !busy && void send()}
      />
      <button style={ghost} disabled={busy} onClick={() => void send()}>
        {busy ? 'Sending…' : 'Email me a sign-in link'}
      </button>
      {status && (
        <span style={{ fontSize: 12, color: 'var(--ink-2)', flexBasis: '100%' }}>{status}</span>
      )}
    </div>
  );
}

export function SavedReports({ refreshKey }: { refreshKey: number }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isBackendConfigured() || !user) {
      setRows([]);
      return;
    }
    try {
      setRows(await listReports());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!isBackendConfigured() || !user) return null;

  const remove = async (id: string) => {
    try {
      await deleteReport(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        padding: 20,
        marginTop: 20,
      }}
    >
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>Saved scans</h2>
      {error && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{error}</p>}
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-2)' }}>
          Nothing saved yet. Run a scan and choose “Save to history”.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {rows.map((r) => (
            <li
              key={r.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '10px 12px',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 14 }}>
                {r.app_name}{' '}
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                {/* A stored report with partial coverage has no score, and says so. */}
                {rowHasOverall(r) ? `${r.overall}/100` : 'no overall score'} · {r.checks_run} checks ·{' '}
                {r.critical_count}C {r.warn_count}W {r.info_count}I
                <button
                  style={{ ...ghost, marginLeft: 10, padding: '3px 8px', fontSize: 12 }}
                  onClick={() => void remove(r.id)}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
