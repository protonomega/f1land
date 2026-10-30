/* Human-readable view of settlement values (shared by the pool result card and the entry proof screen). */
import { DRIVER_BY_ID } from '@/data/teams';
import { fmtClock, fmtLap, fmtNumber, fmtSec, t } from '@/i18n/core';
import type { Settlement } from '@/domain/types';

/** Headline measured values, in display order. Everything else stays in the full proof. */
const HEADLINE = [
  'position',
  'position_a',
  'position_b',
  'status',
  'location',
  'stop_duration_ms',
  'lane_duration_ms',
  'sector_time_ms',
  'lap_time_ms',
  'reference_time_ms',
  'best_a_ms',
  'best_b_ms',
  'best_lap_ms',
  'delta_ms',
  'compound',
  'compound_at_exit',
  'track_state',
  'classification_status',
  'driver_lap',
  'leader_lap',
] as const;

export function valueLabel(k: string): string {
  const key = `val.${k}`;
  const s = t(key);
  return s === key ? k.replace(/_ms$/, '').replace(/_/g, ' ') : s;
}

export function formatValue(k: string, v: string | number | boolean | null): string {
  if (v === null) return '—';
  if (typeof v === 'boolean') return v ? t('ui.yes') : t('ui.no');
  if (typeof v === 'number' && /_ms$/.test(k)) {
    if (k.includes('lap') || k.includes('reference') || k.startsWith('best_')) return fmtLap(v);
    if (k === 'delta_ms' || k === 'gap_ms') return `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtSec(Math.abs(v), 3)} s`;
    return `${fmtSec(v, 3)} s`;
  }
  if (typeof v === 'number' && k.startsWith('position')) return `P${v}`;
  if (typeof v === 'string' && /_at$/.test(k) && !Number.isNaN(Date.parse(v))) return fmtClock(Date.parse(v), true);
  if (typeof v === 'string' && DRIVER_BY_ID[v]) return DRIVER_BY_ID[v]!.lastName;
  if (typeof v === 'number') return fmtNumber(v);
  return String(v);
}

/** Up to `max` headline values of a settlement, formatted for display. */
export function headlineValues(s: Pick<Settlement, 'normalized_values'>, max = 4): Array<{ k: string; label: string; value: string }> {
  const out: Array<{ k: string; label: string; value: string }> = [];
  for (const k of HEADLINE) {
    if (!(k in s.normalized_values)) continue;
    const v = s.normalized_values[k];
    if (v === undefined || v === null) continue;
    out.push({ k, label: valueLabel(k), value: formatValue(k, v) });
    if (out.length >= max) break;
  }
  return out;
}
