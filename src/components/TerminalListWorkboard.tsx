import React, { useMemo, useState } from 'react';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { TerminalList, TerminalListWorkboardRow, InspectorStatus } from '../types';
import { ru } from '../i18n/ru';
import { api, ApiError } from '../api';
import { formatWagonNumber } from '../../server/wagonUtils';
import { resolveInspectorPath } from '../../server/inspectorStatus';
import { WagonStatusBadge } from './StatusBadge';
import { LoadingOverlay } from './LoadingState';
import { InspectorBatchBar, InspectorStatusButtons } from './InspectorStatusPath';

interface ListDetail extends TerminalList {
  rows: TerminalListWorkboardRow[];
}

interface StatusResult {
  route_id: number;
  wagon_id: number;
  terminal_status: string;
  inspector_statuses: InspectorStatus[];
}

interface Props {
  list: ListDetail;
  onBack: () => void;
  onSelectRoute: (routeId: number) => void;
  onStatusChanged: () => void;
  onReload: () => Promise<void>;
  onRename: (displayName: string) => Promise<void>;
  onDelete: () => Promise<void>;
  actionBusy?: boolean;
}

function rowKey(row: TerminalListWorkboardRow): string {
  return `${row.route_id}-${row.route_wagon_id}`;
}

function rowPath(row: TerminalListWorkboardRow): InspectorStatus[] {
  return resolveInspectorPath(row.inspector_statuses, row.terminal_status);
}

export const TerminalListWorkboard: React.FC<Props> = ({
  list,
  onBack,
  onSelectRoute,
  onStatusChanged,
  onReload,
  onRename,
  onDelete,
  actionBusy = false,
}) => {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState(list.rows);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(list.display_name || `#${list.id}`);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  React.useEffect(() => {
    setRows(list.rows);
    setRenameValue(list.display_name || `#${list.id}`);
    setIsRenaming(false);
    setSelected(new Set());
  }, [list]);

  const selectableKeys = useMemo(
    () => rows.filter((row) => row.route_id && row.route_wagon_id).map(rowKey),
    [rows],
  );
  const allSelected = selectableKeys.length > 0 && selectableKeys.every((key) => selected.has(key));

  const submitRename = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = renameValue.trim();
    if (!name) {
      setError(ru.inspector.renameEmpty);
      return;
    }
    setError(null);
    try {
      await onRename(name);
      setIsRenaming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    }
  };

  const applyResult = (routeId: number, wagonId: number, result: StatusResult) => {
    setRows((prev) =>
      prev.map((r) =>
        r.route_id === routeId && r.route_wagon_id === wagonId
          ? {
              ...r,
              terminal_status: result.terminal_status,
              inspector_statuses: result.inspector_statuses,
            }
          : r,
      ),
    );
  };

  const setStatus = async (row: TerminalListWorkboardRow, status: InspectorStatus) => {
    if (!row.route_id || !row.route_wagon_id) return;
    const key = String(row.id);
    setBusyKey(key);
    setIsSaving(true);
    setError(null);
    try {
      const result = await api<StatusResult>(`/api/routes/${row.route_id}/wagons/${row.route_wagon_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal_status: status }),
      });
      applyResult(row.route_id, row.route_wagon_id, result);
      onStatusChanged();
      await onReload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setBusyKey(null);
      setIsSaving(false);
    }
  };

  const applyBatch = async (status: InspectorStatus) => {
    const items = rows
      .filter((row) => row.route_id && row.route_wagon_id && selected.has(rowKey(row)))
      .map((row) => ({ route_id: row.route_id as number, wagon_id: row.route_wagon_id as number }));
    if (!items.length) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await api<{ applied: StatusResult[] }>('/api/inspector/wagon-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, items }),
      });
      for (const item of result.applied || []) {
        applyResult(item.route_id, item.wagon_id, item);
      }
      onStatusChanged();
      await onReload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const linkedCount = rows.filter((r) => r.route_id).length;
  const opLabel = ru.status[list.operation_type as keyof typeof ru.status] || list.operation_type;

  return (
    <div className="space-y-4 relative">
      {(isSaving || actionBusy) && <LoadingOverlay label={ru.inspector.saving} />}

      <div className="card p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="btn btn-ghost tap -ml-2" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" /> {ru.inspector.backToLists}
          </button>
          <div className="flex gap-1">
            <button
              type="button"
              className="btn btn-ghost tap"
              aria-label={ru.actions.edit}
              disabled={actionBusy || isRenaming}
              onClick={() => setIsRenaming(true)}
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="btn btn-ghost tap"
              aria-label={ru.actions.delete}
              disabled={actionBusy}
              onClick={() => onDelete()}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        {isRenaming ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={submitRename}>
            <input
              className="field flex-1 min-w-[12rem]"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              aria-label={ru.inspector.renamePrompt}
              autoFocus
            />
            <button type="submit" className="btn btn-primary" disabled={actionBusy}>
              {ru.actions.save}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={actionBusy}
              onClick={() => {
                setIsRenaming(false);
                setRenameValue(list.display_name || `#${list.id}`);
              }}
            >
              {ru.actions.cancel}
            </button>
          </form>
        ) : (
          <h2 className="text-xl">{list.display_name || `#${list.id}`}</h2>
        )}
        <p className="text-sm text-[var(--muted)]">
          {opLabel} · {list.list_date || '—'} · {rows.length} {ru.inspector.wagonsShort}
          {list.route_display_name ? ` · ${ru.inspector.route}: ${list.route_display_name}` : ''}
        </p>
        <p className="text-sm text-[var(--muted)]">
          {ru.inspector.linkedSummary.replace('{linked}', String(linkedCount)).replace('{total}', String(rows.length))}
        </p>
      </div>

      {error && <div className="badge badge-err p-3 w-full justify-start">{error}</div>}

      <div className="card p-4 space-y-3">
        <h3 className="text-lg">{ru.inspector.statusNow}</h3>
        <InspectorBatchBar
          selectedCount={selected.size}
          selectableCount={selectableKeys.length}
          allSelected={allSelected}
          busy={isSaving}
          onToggleAll={() => {
            setSelected(allSelected ? new Set() : new Set(selectableKeys));
          }}
          onApply={applyBatch}
        />
        <ul className="space-y-3">
          {rows.map((row) => {
            const number = row.parsed_wagon_number || row.raw_wagon_number;
            const canSetStatus = Boolean(row.route_id && row.route_wagon_id);
            const key = rowKey(row);
            const path = rowPath(row);
            return (
              <li key={row.id} className="border border-[var(--line)] rounded-xl p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    {canSetStatus ? (
                      <label className="inline-flex items-center min-h-[var(--tap)]">
                        <input
                          type="checkbox"
                          className="inspector-check"
                          checked={selected.has(key)}
                          onChange={() => toggleOne(key)}
                          aria-label={formatWagonNumber(number)}
                        />
                      </label>
                    ) : null}
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
                  </div>
                  <WagonStatusBadge status={row.terminal_status || 'NOT_AT_TERMINAL'} />
                </div>
                {canSetStatus ? (
                  <InspectorStatusButtons
                    path={path}
                    disabled={busyKey === String(row.id) || isSaving}
                    onSelect={(status) => setStatus(row, status)}
                  />
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
