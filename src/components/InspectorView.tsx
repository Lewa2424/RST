import React, { useCallback, useEffect, useState } from 'react';
import { ProductType, Route, ParsedRowCandidate, InspectorStatus, TerminalList, TerminalListWorkboardRow } from '../types';
import { Plus, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { ru } from '../i18n/ru';
import { api, asItems, asParseRows, ApiError } from '../api';
import { formatWagonNumber } from '../../server/wagonUtils';
import { resolveInspectorPath } from '../../server/inspectorStatus';
import { WagonStatusBadge } from './StatusBadge';
import { LoadingOverlay, Spinner } from './LoadingState';
import { TerminalListWorkboard } from './TerminalListWorkboard';
import { InspectorBatchBar, InspectorStatusButtons } from './InspectorStatusPath';

interface MatchedWagon {
  key: string;
  route_id: number;
  route_name: string;
  wagon_id: number;
  wagon_number: string;
  terminal_status: string;
  inspector_statuses: InspectorStatus[];
}

interface ListDetail extends TerminalList {
  rows: TerminalListWorkboardRow[];
}

interface Props {
  productTypes: ProductType[];
  routes: Route[];
  listsRefreshKey?: number;
  onOpenCreateTerminalList: () => void;
  onSelectRoute: (routeId: number) => void;
  onStatusChanged: () => void;
}

export const InspectorView: React.FC<Props> = ({
  productTypes,
  routes,
  listsRefreshKey = 0,
  onOpenCreateTerminalList,
  onSelectRoute,
  onStatusChanged,
}) => {
  const [manualText, setManualText] = useState('');
  const [productTypeId, setProductTypeId] = useState(productTypes[0]?.id ?? 1);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingLists, setIsLoadingLists] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matched, setMatched] = useState<MatchedWagon[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [savedLists, setSavedLists] = useState<TerminalList[]>([]);
  const [selectedListId, setSelectedListId] = useState<number | null>(null);
  const [selectedList, setSelectedList] = useState<ListDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [listActionBusy, setListActionBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const renameList = async (listId: number, displayName: string) => {
    const name = displayName.trim();
    if (!name) {
      const msg = ru.inspector.renameEmpty;
      setError(msg);
      throw new ApiError(msg, 400);
    }
    setListActionBusy(true);
    setError(null);
    try {
      await api(`/api/terminal-lists/${listId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: name }),
      });
      setRenamingId(null);
      setRenameValue('');
      await loadLists();
      if (selectedListId === listId) await loadListDetail(listId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
      throw err;
    } finally {
      setListActionBusy(false);
    }
  };

  const deleteList = async (tl: TerminalList) => {
    const label = tl.display_name || `#${tl.id}`;
    if (!confirm(ru.inspector.confirmDelete.replace('{name}', label))) return;
    setListActionBusy(true);
    setError(null);
    try {
      await api(`/api/terminal-lists/${tl.id}`, { method: 'DELETE' });
      if (selectedListId === tl.id) {
        setSelectedListId(null);
        setSelectedList(null);
      }
      setRenamingId(null);
      await loadLists();
      onStatusChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setListActionBusy(false);
    }
  };

  const startRename = (tl: TerminalList) => {
    setRenamingId(tl.id);
    setRenameValue(tl.display_name || `#${tl.id}`);
  };

  const loadLists = useCallback(async () => {
    setIsLoadingLists(true);
    try {
      const qs = new URLSearchParams({ limit: '50' });
      if (productTypeId) qs.set('product_type_id', String(productTypeId));
      const data = await api(`/api/terminal-lists?${qs.toString()}`);
      setSavedLists(asItems<TerminalList>(data));
    } catch {
      setSavedLists([]);
    } finally {
      setIsLoadingLists(false);
    }
  }, [productTypeId]);

  const loadListDetail = useCallback(async (listId: number) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const detail = await api<ListDetail>(`/api/terminal-lists/${listId}`);
      setSelectedList(detail);
      setSelectedListId(listId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
      setSelectedList(null);
      setSelectedListId(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists, listsRefreshKey]);

  useEffect(() => {
    if (!selectedListId) return;
    loadListDetail(selectedListId);
  }, [selectedListId, loadListDetail, listsRefreshKey]);

  const findInRoutes = async () => {
    if (!manualText.trim()) return;
    setIsParsing(true);
    setError(null);
    try {
      const parsed = asParseRows(
        await api('/api/imports/parse-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: manualText, entity_type: 'TERMINAL_LIST' }),
        }),
      );
      const rows = (parsed.rows || []) as ParsedRowCandidate[];
      const numbers = rows
        .map((r) => r.parsed_wagon_number || r.raw_wagon_number)
        .filter(Boolean)
        .map((n) => String(n));

      if (!numbers.length) {
        setMatched([]);
        setError(ru.inspector.empty);
        return;
      }

      const candidates = await api<Array<{ id: number; display_name: string; matches: number; total_in_route: number }>>(
        '/api/terminal-lists/match-candidates',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_type_id: productTypeId, wagon_numbers: numbers }),
        },
      );

      const numberSet = new Set(numbers.map((n) => n.replace(/\D/g, '')));
      const found: MatchedWagon[] = [];
      const list = Array.isArray(candidates) ? candidates : [];

      for (const c of list) {
        const detail = await api<{
          id: number;
          display_name: string;
          wagons: Array<{
            wagon_id: number;
            wagon_number: string;
            terminal_status: string;
            inspector_statuses?: InspectorStatus[];
          }>;
        }>(`/api/routes/${c.id}`);
        for (const w of detail.wagons || []) {
          const digits = String(w.wagon_number || '').replace(/\D/g, '');
          if (!numberSet.has(digits)) continue;
          found.push({
            key: `${detail.id}-${w.wagon_id}`,
            route_id: detail.id,
            route_name: detail.display_name,
            wagon_id: w.wagon_id,
            wagon_number: w.wagon_number,
            terminal_status: w.terminal_status,
            inspector_statuses: resolveInspectorPath(w.inspector_statuses, w.terminal_status),
          });
        }
      }

      if (!found.length) {
        for (const route of routes) {
          const detail = await api<{
            id: number;
            display_name: string;
            wagons: Array<{
              wagon_id: number;
              wagon_number: string;
              terminal_status: string;
              inspector_statuses?: InspectorStatus[];
            }>;
          }>(`/api/routes/${route.id}`);
          for (const w of detail.wagons || []) {
            const digits = String(w.wagon_number || '').replace(/\D/g, '');
            if (!numberSet.has(digits)) continue;
            found.push({
              key: `${detail.id}-${w.wagon_id}`,
              route_id: detail.id,
              route_name: detail.display_name,
              wagon_id: w.wagon_id,
              wagon_number: w.wagon_number,
              terminal_status: w.terminal_status,
              inspector_statuses: resolveInspectorPath(w.inspector_statuses, w.terminal_status),
            });
          }
        }
      }

      setMatched(found);
      setSelected(new Set());
      if (!found.length) setError(ru.inspector.empty);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
      setMatched([]);
    } finally {
      setIsParsing(false);
    }
  };

  const setStatus = async (row: MatchedWagon, status: InspectorStatus) => {
    setBusyKey(row.key);
    setIsSaving(true);
    setError(null);
    try {
      const result = await api<{ terminal_status: string; inspector_statuses: InspectorStatus[] }>(
        `/api/routes/${row.route_id}/wagons/${row.wagon_id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ terminal_status: status }),
        },
      );
      setMatched((prev) =>
        prev.map((m) =>
          m.key === row.key
            ? {
                ...m,
                terminal_status: result.terminal_status,
                inspector_statuses: result.inspector_statuses,
              }
            : m,
        ),
      );
      onStatusChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setBusyKey(null);
      setIsSaving(false);
    }
  };

  const applyBatch = async (status: InspectorStatus) => {
    const items = matched
      .filter((row) => selected.has(row.key))
      .map((row) => ({ route_id: row.route_id, wagon_id: row.wagon_id }));
    if (!items.length) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await api<{
        applied: Array<{
          route_id: number;
          wagon_id: number;
          terminal_status: string;
          inspector_statuses: InspectorStatus[];
        }>;
      }>('/api/inspector/wagon-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, items }),
      });
      const byKey = new Map((result.applied || []).map((item) => [`${item.route_id}-${item.wagon_id}`, item]));
      setMatched((prev) =>
        prev.map((m) => {
          const next = byKey.get(m.key);
          return next
            ? { ...m, terminal_status: next.terminal_status, inspector_statuses: next.inspector_statuses }
            : m;
        }),
      );
      onStatusChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setIsSaving(false);
    }
  };

  if (selectedListId && selectedList) {
    return (
      <TerminalListWorkboard
        list={selectedList}
        onBack={() => {
          setSelectedListId(null);
          setSelectedList(null);
          loadLists();
        }}
        onSelectRoute={onSelectRoute}
        onStatusChanged={onStatusChanged}
        onReload={async () => {
          if (selectedListId) await loadListDetail(selectedListId);
        }}
        onRename={(name) => renameList(selectedList.id, name)}
        onDelete={() => deleteList(selectedList)}
        actionBusy={listActionBusy}
      />
    );
  }

  if (loadingDetail) {
    return (
      <div className="relative min-h-[200px]">
        <LoadingOverlay label={ru.loading.load} />
      </div>
    );
  }

  return (
    <div className="space-y-4 relative">
      {(isParsing || isSaving || isLoadingLists || listActionBusy) && (
        <LoadingOverlay label={isParsing ? ru.loading.parse : isSaving ? ru.inspector.saving : ru.loading.load} />
      )}

      <div className="card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl">{ru.inspector.title}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{ru.inspector.subtitle}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onOpenCreateTerminalList}>
          <Plus className="w-4 h-4" /> {ru.inspector.createList}
        </button>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg">{ru.inspector.savedLists}</h2>
            <p className="text-sm text-[var(--muted)]">{ru.inspector.savedListsHint}</p>
          </div>
          <div className="w-full sm:w-auto sm:min-w-[200px]">
            <label className="lbl" htmlFor="inspector-lists-product">{ru.createRoute.product}</label>
            <select
              id="inspector-lists-product"
              className="field"
              value={productTypeId}
              onChange={(e) => setProductTypeId(Number(e.target.value))}
            >
              {productTypes.map((pt) => (
                <option key={pt.id} value={pt.id}>{pt.name}</option>
              ))}
            </select>
          </div>
        </div>

        {savedLists.length === 0 ? (
          <div className="py-8 text-center">
            <p className="font-semibold">{ru.inspector.noLists}</p>
            <p className="text-sm text-[var(--muted)] mt-1">{ru.inspector.noListsHint}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {savedLists.map((tl) => {
              const opLabel = ru.status[tl.operation_type as keyof typeof ru.status] || tl.operation_type;
              const label = tl.display_name || `#${tl.id}`;
              return (
                <li key={tl.id} className="card p-2 flex items-stretch gap-1">
                  {renamingId === tl.id ? (
                    <form
                      className="flex flex-1 flex-wrap items-center gap-2 p-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        renameList(tl.id, renameValue);
                      }}
                    >
                      <input
                        className="field flex-1 min-w-[10rem]"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        aria-label={ru.inspector.renamePrompt}
                        autoFocus
                      />
                      <button type="submit" className="btn btn-primary" disabled={listActionBusy}>
                        {ru.actions.save}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={listActionBusy}
                        onClick={() => {
                          setRenamingId(null);
                          setRenameValue('');
                        }}
                      >
                        {ru.actions.cancel}
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="flex-1 rounded-lg p-3 flex items-center justify-between gap-3 text-left min-h-[var(--tap)] row-interactive"
                        onClick={() => setSelectedListId(tl.id)}
                      >
                        <div>
                          <div className="font-semibold">{label}</div>
                          <div className="text-sm text-[var(--muted)] mt-0.5">
                            {opLabel} · {tl.list_date || '—'}
                            {tl.rows_count != null ? ` · ${tl.rows_count} ${ru.inspector.wagonsShort}` : ''}
                            {tl.route_display_name ? ` · ${tl.route_display_name}` : ''}
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-[var(--muted)] shrink-0" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost tap shrink-0"
                        aria-label={ru.actions.edit}
                        disabled={listActionBusy}
                        onClick={() => startRename(tl)}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost tap shrink-0"
                        aria-label={ru.actions.delete}
                        disabled={listActionBusy}
                        onClick={() => deleteList(tl)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <details className="card p-4 group">
        <summary className="cursor-pointer font-semibold list-none flex items-center justify-between">
          {ru.inspector.quickSearch}
          <ChevronRight className="w-4 h-4 text-[var(--muted)] group-open:rotate-90 transition-transform" />
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm text-[var(--muted)]">{ru.inspector.pasteHint}</p>
          <textarea
            className="field min-h-28"
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder={ru.createRoute.manualHint}
          />
          <button type="button" className="btn btn-secondary" onClick={findInRoutes} disabled={isParsing || !manualText.trim()}>
            {isParsing ? <Spinner /> : null} {ru.inspector.parse}
          </button>

          {error && <div className="badge badge-err p-3 w-full justify-start">{error}</div>}

          {matched.length > 0 && (
            <div className="space-y-3 pt-2">
              <InspectorBatchBar
                selectedCount={selected.size}
                selectableCount={matched.length}
                allSelected={matched.length > 0 && matched.every((row) => selected.has(row.key))}
                busy={isSaving}
                onToggleAll={() => {
                  setSelected(
                    matched.every((row) => selected.has(row.key))
                      ? new Set()
                      : new Set(matched.map((row) => row.key)),
                  );
                }}
                onApply={applyBatch}
              />
              <ul className="space-y-3">
                {matched.map((row) => (
                  <li key={row.key} className="border border-[var(--line)] rounded-xl p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <label className="inline-flex items-center min-h-[var(--tap)]">
                          <input
                            type="checkbox"
                            className="inspector-check"
                            checked={selected.has(row.key)}
                            onChange={() => {
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(row.key)) next.delete(row.key);
                                else next.add(row.key);
                                return next;
                              });
                            }}
                            aria-label={formatWagonNumber(row.wagon_number)}
                          />
                        </label>
                        <div>
                          <div className="wagon-no font-semibold">{formatWagonNumber(row.wagon_number)}</div>
                          <button
                            type="button"
                            className="text-sm text-[var(--steel)]"
                            onClick={() => onSelectRoute(row.route_id)}
                          >
                            {ru.inspector.route}: {row.route_name}
                          </button>
                        </div>
                      </div>
                      <WagonStatusBadge status={row.terminal_status} />
                    </div>
                    <InspectorStatusButtons
                      path={row.inspector_statuses}
                      disabled={busyKey === row.key || isSaving}
                      onSelect={(status) => setStatus(row, status)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
    </div>
  );
};
