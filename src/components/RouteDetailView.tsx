import React, { useState } from 'react';
import { Route, RouteWagon, Discrepancy, TerminalList } from '../types';
import { ArrowLeft, Plus, Pencil, Archive, RefreshCw } from 'lucide-react';
import { ru } from '../i18n/ru';
import { ChecksumBadge, RouteStatusBadge, WagonStatusBadge } from './StatusBadge';
import { formatWagonNumber } from '../../server/wagonUtils';

const TIP_DISCREPANCY_TYPES = new Set([
  'EXTRA_IN_TERMINAL_LIST',
  'MISSING_IN_TERMINAL_LIST',
  'WEIGHT_MISMATCH',
]);

function discrepancyLabel(d: Discrepancy): string {
  const base = ru.discrepancy[d.type as keyof typeof ru.discrepancy] || d.type;
  if (d.type !== 'INVALID_CHECK_DIGIT') return base;
  try {
    const details = JSON.parse(d.details_json || '{}') as { suggested_wagon_number?: string };
    if (details.suggested_wagon_number) {
      return `${base} · ${ru.checksum.suggested}: ${formatWagonNumber(details.suggested_wagon_number)}`;
    }
  } catch {
    // keep base label
  }
  return base;
}

function formatProgressSummary(processed: number, total: number, lists: number): string {
  return ru.route.progressSummary
    .replace('{processed}', String(processed))
    .replace('{total}', String(total))
    .replace('{lists}', String(lists));
}

interface Props {
  route: Route & { wagons: RouteWagon[]; discrepancies: Discrepancy[]; terminal_lists: TerminalList[] };
  onBack: () => void;
  onEditRoute: () => void;
  onEditWagonRow: (wagon: RouteWagon) => void;
  onOpenAddWagonsModal: () => void;
  onOpenAddTerminalListForRoute: () => void;
  onCloseRoute: () => void;
  onArchiveRoute: () => void;
  onUnarchiveRoute: () => void;
  onReconcileNow: () => void;
}

export const RouteDetailView: React.FC<Props> = ({
  route, onBack, onEditRoute, onEditWagonRow, onOpenAddWagonsModal, onOpenAddTerminalListForRoute,
  onCloseRoute, onArchiveRoute, onUnarchiveRoute, onReconcileNow,
}) => {
  const [filterTab, setFilterTab] = useState('ALL');
  const openDiscrepancies = (route.discrepancies || []).filter((d) => d.status === 'OPEN');
  const materialIssues = openDiscrepancies.filter((d) => !TIP_DISCREPANCY_TYPES.has(d.type));
  const extra = openDiscrepancies.filter((d) => d.type === 'EXTRA_IN_TERMINAL_LIST');
  const missingCount = openDiscrepancies.filter((d) => d.type === 'MISSING_IN_TERMINAL_LIST').length;
  const weightTips = openDiscrepancies.filter((d) => d.type === 'WEIGHT_MISMATCH');
  const canClose = route.status !== 'CLOSED' && route.status !== 'ARCHIVED';
  const remaining = Math.max(0, route.wagon_count - route.processed_count);
  const listsCount = (route.terminal_lists || []).length;

  const filteredWagons = (route.wagons || []).filter((w) => {
    if (filterTab === 'ALL') return true;
    if (filterTab === 'PENDING') return w.processed_for_route === 0;
    if (filterTab === 'AT_TERMINAL') return w.terminal_status === 'AT_TERMINAL';
    if (filterTab === 'UNLOADED') return w.terminal_status === 'UNLOADED';
    if (filterTab === 'CLEANED') return w.terminal_status === 'CLEANED';
    if (filterTab === 'LOADED') return w.terminal_status === 'LOADED';
    if (filterTab === 'DEPARTED') return w.terminal_status.startsWith('DEPARTED');
    if (filterTab === 'DISCREPANCIES') {
      const wagonDisc = (w.discrepancies || []).filter((d) => !TIP_DISCREPANCY_TYPES.has(d.type));
      return wagonDisc.length > 0 || !w.is_checksum_valid;
    }
    return true;
  });

  const filters = [
    ['ALL', ru.route.filters.all],
    ['PENDING', ru.route.filters.pending],
    ['AT_TERMINAL', ru.route.filters.atTerminal],
    ['UNLOADED', ru.route.filters.unloaded],
    ['CLEANED', ru.route.filters.cleaned],
    ['LOADED', ru.route.filters.loaded],
    ['DEPARTED', ru.route.filters.departed],
    ['DISCREPANCIES', ru.route.filters.discrepancies],
  ];

  const wagonMatchLabel = (w: RouteWagon) => {
    const tips = (w.discrepancies || []).filter((d) => TIP_DISCREPANCY_TYPES.has(d.type));
    const issues = (w.discrepancies || []).filter((d) => !TIP_DISCREPANCY_TYPES.has(d.type));
    if (issues.length > 0) {
      return issues.map((d) => (
        <div key={d.id} className="text-[var(--err)]">{discrepancyLabel(d)}</div>
      ));
    }
    if (tips.length > 0) {
      return tips.map((d) => (
        <div key={d.id} className="text-[var(--muted)]">{discrepancyLabel(d)}</div>
      ));
    }
    return <span className="text-[var(--ok)]">{ru.route.matches}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex items-start gap-3">
          <button type="button" className="btn btn-secondary tap" onClick={onBack} aria-label={ru.actions.back}><ArrowLeft className="w-4 h-4" /></button>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl truncate">{route.display_name}</h1>
              <RouteStatusBadge status={route.status} />
              <button type="button" className="btn btn-ghost tap" aria-label={ru.actions.edit} onClick={onEditRoute}><Pencil className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-[var(--muted)] mt-1">
              {route.internal_code} · {route.product_type_name}
              {route.station_name ? ` · ${route.station_name}` : ''}
              {route.route_date ? ` · ${route.route_date}` : ''}
            </p>
            <p className="text-sm text-[var(--muted)] mt-1">
              {formatProgressSummary(route.processed_count, route.wagon_count, listsCount)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={onReconcileNow}><RefreshCw className="w-4 h-4" /> {ru.actions.reconcile}</button>
          <button type="button" className="btn btn-secondary" onClick={onOpenAddWagonsModal}><Plus className="w-4 h-4" /> {ru.route.addWagons}</button>
          <button type="button" className="btn btn-ghost" onClick={onOpenAddTerminalListForRoute}><Plus className="w-4 h-4" /> {ru.route.addList}</button>
          {canClose && <button type="button" className="btn btn-primary" onClick={onCloseRoute}>{ru.actions.closeRoute}</button>}
          {route.status === 'ARCHIVED' ? (
            <button type="button" className="btn btn-secondary" onClick={onUnarchiveRoute}>{ru.actions.unarchive}</button>
          ) : route.status === 'CLOSED' ? (
            <button type="button" className="btn btn-secondary" onClick={onArchiveRoute}><Archive className="w-4 h-4" /> {ru.actions.archive}</button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="card card-metric p-3"><div className="text-xs text-[var(--muted)]">Всего</div><div className="text-xl font-semibold">{route.wagon_count}</div></div>
        <div className="card card-metric p-3"><div className="text-xs text-[var(--ok)]">На терминале</div><div className="text-xl font-semibold text-[var(--ok)]">{route.processed_count}</div></div>
        <div className="card card-metric p-3"><div className="text-xs text-[var(--wait)]">Ожидаются</div><div className="text-xl font-semibold text-[var(--wait)]">{remaining}</div></div>
        <div className="card card-metric p-3"><div className="text-xs text-[var(--err)]">Ошибки</div><div className="text-xl font-semibold text-[var(--err)]">{materialIssues.length}</div></div>
      </div>

      {materialIssues.length > 0 && (
        <div className="card p-4 border-[var(--err)]">
          <p className="font-semibold text-[var(--err)] mb-2">{ru.route.openIssues}</p>
          <ul className="text-sm space-y-1">
            {materialIssues.slice(0, 8).map((d) => (
              <li key={d.id}>{discrepancyLabel(d)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-4 space-y-3">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {filters.map(([id, label]) => (
            <button key={id} type="button" className={`btn whitespace-nowrap ${filterTab === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilterTab(id)}>{label}</button>
          ))}
        </div>

        <div className="md:hidden space-y-3">
          {filteredWagons.map((w) => (
            <article key={w.id} className="card-interactive border border-[var(--line)] rounded-xl p-3 space-y-2">
              <div className="flex justify-between gap-2">
                <span className="wagon-no">{formatWagonNumber(w.wagon_number)}</span>
                <button type="button" className="btn btn-ghost tap" aria-label={ru.actions.edit} onClick={() => onEditWagonRow(w)}><Pencil className="w-4 h-4" /></button>
              </div>
              <ChecksumBadge ok={Boolean(w.is_checksum_valid)} wagonNumber={w.wagon_number} />
              <WagonStatusBadge status={w.terminal_status} />
              <p className="text-sm">{ru.route.declared}: {w.declared_weight_kg ? `${w.declared_weight_kg.toLocaleString('ru-RU')} кг` : '—'} · {ru.route.terminal}: {w.terminal_weight_kg ? `${w.terminal_weight_kg.toLocaleString('ru-RU')} кг` : '—'}</p>
              <div className="text-sm">{wagonMatchLabel(w)}</div>
            </article>
          ))}
        </div>

        <div className="hidden md:block table-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--muted)] border-b border-[var(--line)]">
                <th className="py-2">№</th>
                <th>Вагон</th>
                <th>КС</th>
                <th>{ru.route.declared}</th>
                <th>{ru.route.terminal}</th>
                <th>Статус</th>
                <th>{ru.route.match}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredWagons.map((w) => (
                <tr key={w.id} className="border-b border-[var(--line)] row-interactive">
                  <td className="py-2">{w.sequence_no}</td>
                  <td><span className="wagon-no">{formatWagonNumber(w.wagon_number)}</span></td>
                  <td><ChecksumBadge ok={Boolean(w.is_checksum_valid)} wagonNumber={w.wagon_number} /></td>
                  <td>{w.declared_weight_kg ? `${w.declared_weight_kg.toLocaleString('ru-RU')} кг` : '—'}</td>
                  <td>{w.terminal_weight_kg ? `${w.terminal_weight_kg.toLocaleString('ru-RU')} кг` : '—'}</td>
                  <td><WagonStatusBadge status={w.terminal_status} /></td>
                  <td>{wagonMatchLabel(w)}</td>
                  <td><button type="button" className="btn btn-ghost tap" aria-label={ru.actions.edit} onClick={() => onEditWagonRow(w)}><Pencil className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-4 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg">{ru.route.lists}</h2>
            <p className="text-sm text-[var(--muted)]">{ru.route.listsHint}</p>
            <p className="text-sm mt-1">{formatProgressSummary(route.processed_count, route.wagon_count, listsCount)}</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onOpenAddTerminalListForRoute}>
            <Plus className="w-4 h-4" /> {ru.route.addList}
          </button>
        </div>
        {listsCount > 0 ? (
          <ul className="space-y-2 text-sm">
            {route.terminal_lists.map((tl) => (
              <li key={tl.id} className="flex justify-between gap-2 border-b border-[var(--line)] pb-2">
                <span>{tl.display_name || `#${tl.id}`} · {ru.status[tl.operation_type as keyof typeof ru.status] || tl.operation_type}</span>
                <span className="text-[var(--muted)]">{tl.status} · {tl.list_date}{tl.rows_count != null ? ` · ${tl.rows_count}` : ''}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--muted)]">{ru.route.listsHint}</p>
        )}
      </div>

      {(extra.length > 0 || missingCount > 0 || weightTips.length > 0) && (
        <div className="card p-4 bg-[var(--steel-soft)]/40">
          <h2 className="text-lg mb-1">{ru.route.tipsTitle}</h2>
          {missingCount > 0 && (
            <p className="text-sm text-[var(--muted)] mb-2">{ru.route.tipsMissing}: {missingCount}</p>
          )}
          {extra.length > 0 && (
            <>
              <p className="text-sm text-[var(--muted)] mb-2">{ru.route.tipsExtra}</p>
              <ul className="space-y-1">
                {extra.map((d) => {
                  let extraNo = '';
                  try {
                    extraNo = JSON.parse(d.details_json || '{}').extra_wagon_number || '';
                  } catch {
                    extraNo = d.details_json;
                  }
                  return (
                    <li key={d.id} className="flex items-center gap-2">
                      <span className="text-sm text-[var(--muted)]">{ru.route.extraWagon}:</span>
                      <span className="wagon-no">{formatWagonNumber(extraNo || d.details_json)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {weightTips.length > 0 && (
            <ul className="text-sm text-[var(--muted)] mt-2 space-y-1">
              {weightTips.slice(0, 8).map((d) => (
                <li key={d.id}>{discrepancyLabel(d)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
