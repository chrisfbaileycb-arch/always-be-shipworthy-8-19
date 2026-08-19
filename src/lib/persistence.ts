/**
 * Persistence — saving scans and apps.
 *
 * Two rules this module exists to hold:
 *
 * 1. **Saving is opt-in.** Scans run locally and are written here only when the
 *    user asks. The privacy claim ("runs in your browser, nothing is uploaded")
 *    stays true for the default path, and the moment it stops being true is a
 *    button the user pressed.
 *
 * 2. **`overall` may be null, all the way down.** A report with partial module
 *    coverage has no overall score, and that has to survive the round trip
 *    through Postgres and back. A column defaulting to 0 — or a deserialiser
 *    coercing null to a number — would put the false-pass bug back in via the
 *    database. `reportRowToSummaryish` and the schema both preserve null.
 *
 * user_id is never sent from the client. The column defaults to auth.uid() and
 * the RLS policy checks it, so the server decides ownership, not the browser.
 */

import type { PostgrestError } from '@supabase/supabase-js';
import { summarise } from '../core/report';
import type { ModuleResult, Report } from '../core/types';
import { getSupabase } from './supabase';

export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

// ─── Row shapes ──────────────────────────────────────────────────────────────

export interface AppRow {
  id: string;
  name: string;
  platform: 'android' | 'ios' | 'web' | 'unknown';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportRow {
  id: string;
  app_id: string | null;
  app_name: string;
  modules: ModuleResult[];
  /** Null when coverage was partial. Never coerce this to a number. */
  overall: number | null;
  coverage: number;
  assessed_count: number;
  checks_run: number;
  critical_count: number;
  warn_count: number;
  info_count: number;
  rules_as_of: string;
  created_at: string;
}

export type NewReportRow = Omit<ReportRow, 'id' | 'created_at'>;

// ─── Serialisation (pure — unit tested without a database) ───────────────────

export function serializeReport(report: Report, appId: string | null = null): NewReportRow {
  const s = summarise(report);
  return {
    app_id: appId,
    app_name: report.appName,
    modules: report.modules,
    overall: s.overall, // null stays null
    coverage: s.coverage,
    assessed_count: s.assessedCount,
    checks_run: s.totalChecksRun,
    critical_count: s.findings.critical,
    warn_count: s.findings.warn,
    info_count: s.findings.info,
    rules_as_of: report.rulesAsOf,
  };
}

export function deserializeReport(row: ReportRow): Report {
  return {
    appName: row.app_name,
    createdAt: new Date(row.created_at).getTime(),
    rulesAsOf: row.rules_as_of,
    modules: row.modules,
  };
}

/**
 * Whether a stored row is safe to render with a headline score.
 * Mirrors `summarise()` — a row with any unassessed module has no overall.
 */
export function rowHasOverall(row: Pick<ReportRow, 'overall'>): boolean {
  return row.overall !== null && row.overall !== undefined;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

function describe(error: PostgrestError): PersistenceError {
  // 42501 = insufficient privilege; PGRST301 = JWT expired / not authenticated.
  if (error.code === '42501' || error.code === 'PGRST301') {
    return new PersistenceError('You need to be signed in to do that. Try signing in again.');
  }
  if (error.code === '23505') {
    return new PersistenceError('That already exists.');
  }
  if (error.code === '23514') {
    return new PersistenceError('That value was rejected by the database. Check the field lengths.');
  }
  return new PersistenceError('Could not reach your saved data. Please try again.');
}

function requireClient() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new PersistenceError('Saving is unavailable: this instance has no backend configured.');
  }
  return supabase;
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export async function saveReport(report: Report, appId: string | null = null): Promise<ReportRow> {
  const supabase = requireClient();
  const { data, error } = await supabase
    .from('reports')
    .insert(serializeReport(report, appId))
    .select()
    .single();
  if (error) throw describe(error);
  return data as ReportRow;
}

export async function listReports(limit = 25): Promise<ReportRow[]> {
  const supabase = requireClient();
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw describe(error);
  return (data ?? []) as ReportRow[];
}

export async function deleteReport(id: string): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.from('reports').delete().eq('id', id);
  if (error) throw describe(error);
}

// ─── Apps ────────────────────────────────────────────────────────────────────

export async function listApps(): Promise<AppRow[]> {
  const supabase = requireClient();
  const { data, error } = await supabase
    .from('apps')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw describe(error);
  return (data ?? []) as AppRow[];
}

export async function createApp(
  name: string,
  platform: AppRow['platform'] = 'unknown',
): Promise<AppRow> {
  const supabase = requireClient();
  const trimmed = name.trim();
  if (!trimmed) throw new PersistenceError('An app needs a name.');
  const { data, error } = await supabase
    .from('apps')
    .insert({ name: trimmed, platform })
    .select()
    .single();
  if (error) throw describe(error);
  return data as AppRow;
}

export async function deleteApp(id: string): Promise<void> {
  const supabase = requireClient();
  const { error } = await supabase.from('apps').delete().eq('id', id);
  if (error) throw describe(error);
}
