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
  list_row_id: number;
  terminal_list_id: number;
  terminal_status: string;
  inspector_statuses: InspectorStatus[];
}

interface Props {
  list: ListDetail;
  onBack: () => void;
  onStatusChanged: () => void;
  onReload: () => Promise<void>;
  onRename: (displayName: string) => Promise<void>;
  onDelete: () => Promise<void>;
  actionBusy?: boolean;
}

function rowPath(row: TerminalListWorkboardRow): InspectorStatus[] {
  return resolveInspectorPath(row.inspector_statuses, row.terminal_status);
}

export const TerminalListWorkboard: React.FC<Props> = ({
  list,
  onBack,
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
  const [selected, setSelected] = useState<Set<number>>(new Set());

  React.useEffect(() => {
    setRows(list.rows);
    setRenameValue(list.display_name || `#${list.id}`);
    setIsRenaming(false);
    setSelected(new Set());
  }, [list]);

  const selectableIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

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

  const applyResult = (result: StatusResult) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === result.list_row_id
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
    setBusyKey(String(row.id));
    setIsSaving(true);
    setError(null);
    try {
      const result = await api<StatusResult>(`/api/terminal-list-rows/${row.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      applyResult(result);
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
    const listRowIds = rows.filter((row) => selected.has(row.id)).map((row) => row.id);
    if (!listRowIds.length) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await api<{ applied: StatusResult[] }>('/api/inspector/wagon-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, list_row_ids: listRowIds }),
      });
      for (const item of result.applied || []) {
        applyResult(item);
      }
      onStatusChanged();
      await onReload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
          selectableCount={selectableIds.length}
          allSelected={allSelected}
          busy={isSaving}
          onToggleAll={() => {
            setSelected(allSelected ? new Set() : new Set(selectableIds));
          }}
          onApply={applyBatch}
        />
        <ul className="space-y-3">
          {rows.map((row) => {
            const number = row.parsed_wagon_number || row.raw_wagon_number;
            const path = rowPath(row);
            return (
              <li key={row.id} className="border border-[var(--line)] rounded-xl p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <label className="inline-flex items-center min-h-[var(--tap)]">
                      <input
                        type="checkbox"
                        className="inspector-check"
                        checked={selected.has(row.id)}
                        onChange={() => toggleOne(row.id)}
                        aria-label={formatWagonNumber(number)}
                      />
                    </label>
                    <div>
                      <div className="wagon-no font-semibold">{formatWagonNumber(number)}</div>
                      {row.route_id && row.route_name ? (
                        <p className="text-sm text-[var(--steel)]">
                          {ru.inspector.route}: {row.route_name}
                        </p>
                      ) : (
                        <p className="text-sm text-[var(--muted)]">{ru.inspector.noRouteForWagon}</p>
                      )}
                    </div>
                  </div>
                  <WagonStatusBadge status={row.terminal_status || 'NOT_AT_TERMINAL'} />
                </div>
                <InspectorStatusButtons
                  path={path}
                  disabled={busyKey === String(row.id) || isSaving}
                  onSelect={(status) => setStatus(row, status)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
