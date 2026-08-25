import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { TerminalList, TerminalListWorkboardRow, TerminalStatus } from '../types';
import { ru } from '../i18n/ru';
import { api, ApiError } from '../api';
import { formatWagonNumber } from '../../server/wagonUtils';
import { WagonStatusBadge } from './StatusBadge';
import { LoadingOverlay } from './LoadingState';

const INSPECTOR_STATUSES: Array<{ value: TerminalStatus; label: string }> = [
  { value: 'AT_TERMINAL', label: ru.inspector.statuses.AT_TERMINAL },
  { value: 'UNLOADED', label: ru.inspector.statuses.UNLOADED },
  { value: 'CLEANED', label: ru.inspector.statuses.CLEANED },
  { value: 'LOADED', label: ru.inspector.statuses.LOADED },
  { value: 'DEPARTED_EMPTY', label: ru.inspector.statuses.DEPARTED_EMPTY },
];

interface ListDetail extends TerminalList {
  rows: TerminalListWorkboardRow[];
}

interface Props {
  list: ListDetail;
  onBack: () => void;
  onSelectRoute: (routeId: number) => void;
  onStatusChanged: () => void;
  onReload: () => Promise<void>;
}

export const TerminalListWorkboard: React.FC<Props> = ({
  list,
  onBack,
  onSelectRoute,
  onStatusChanged,
  onReload,
}) => {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState(list.rows);

  React.useEffect(() => {
    setRows(list.rows);
  }, [list]);

  const setStatus = async (row: TerminalListWorkboardRow, status: TerminalStatus) => {
    if (!row.route_id || !row.route_wagon_id) return;
    const key = String(row.id);
    setBusyKey(key);
    setIsSaving(true);
    setError(null);
    try {
      await api(`/api/routes/${row.route_id}/wagons/${row.route_wagon_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal_status: status }),
      });
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, terminal_status: status } : r)),
      );
      onStatusChanged();
      await onReload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setBusyKey(null);
      setIsSaving(false);
    }
  };

  const linkedCount = rows.filter((r) => r.route_id).length;
  const opLabel = ru.status[list.operation_type as keyof typeof ru.status] || list.operation_type;

  return (
    <div className="space-y-4 relative">
      {isSaving && <LoadingOverlay label={ru.inspector.saving} />}

      <div className="card p-4 space-y-2">
        <button type="button" className="btn btn-ghost tap -ml-2" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" /> {ru.inspector.backToLists}
        </button>
        <h2 className="text-xl">{list.display_name || `#${list.id}`}</h2>
        <p className="text-sm text-[var(--muted)]">
          {opLabel} · {list.list_date || '—'} · {rows.length} {ru.inspector.wagonsShort}
          {list.route_display_name ? ` · ${ru.inspector.route}: ${list.route_display_name}` : ''}
        </p>
        <p className="text-sm text-[var(--muted)]">
          {ru.inspector.linkedSummary.replace('{linked}', String(linkedCount)).replace('{total}', String(rows.length))}
        </p>
      </div>

      {error && <div className="badge badge-err p-3 w-full justify-start">{error}</div>}

      <div className="card p-4">
        <h3 className="text-lg mb-3">{ru.inspector.statusNow}</h3>
        <ul className="space-y-3">
          {rows.map((row) => {
            const number = row.parsed_wagon_number || row.raw_wagon_number;
            const canSetStatus = Boolean(row.route_id && row.route_wagon_id);
            return (
              <li key={row.id} className="border border-[var(--line)] rounded-xl p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="wagon-no font-semibold">{formatWagonNumber(number)}</div>
                    {row.route_id && row.route_name ? (
                      <button
                        type="button"
                        className="text-sm text-[var(--steel)]"
                        onClick={() => onSelectRoute(row.route_id!)}
                      >
                        {ru.inspector.route}: {row.route_name}
                      </button>
                    ) : (
                      <p className="text-sm text-[var(--muted)]">{ru.inspector.noRouteForWagon}</p>
                    )}
                  </div>
                  <WagonStatusBadge status={row.terminal_status || 'NOT_AT_TERMINAL'} />
                </div>
                {canSetStatus ? (
                  <div className="flex flex-wrap gap-2">
                    {INSPECTOR_STATUSES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        className={`btn tap ${row.terminal_status === s.value ? 'btn-primary' : 'btn-secondary'}`}
                        disabled={busyKey === String(row.id)}
                        onClick={() => setStatus(row, s.value)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--muted)]">{ru.inspector.bindRouteHint}</p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
