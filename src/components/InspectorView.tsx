import React, { useState } from 'react';
import { ProductType, Route, ParsedRowCandidate, TerminalStatus } from '../types';
import { Plus } from 'lucide-react';
import { ru } from '../i18n/ru';
import { api, asParseRows, ApiError } from '../api';
import { formatWagonNumber } from '../../server/wagonUtils';
import { WagonStatusBadge } from './StatusBadge';
import { LoadingOverlay, Spinner } from './LoadingState';

const INSPECTOR_STATUSES: Array<{ value: TerminalStatus; label: string }> = [
  { value: 'AT_TERMINAL', label: ru.inspector.statuses.AT_TERMINAL },
  { value: 'UNLOADED', label: ru.inspector.statuses.UNLOADED },
  { value: 'CLEANED', label: ru.inspector.statuses.CLEANED },
  { value: 'LOADED', label: ru.inspector.statuses.LOADED },
  { value: 'DEPARTED_EMPTY', label: ru.inspector.statuses.DEPARTED_EMPTY },
];

interface MatchedWagon {
  key: string;
  route_id: number;
  route_name: string;
  wagon_id: number;
  wagon_number: string;
  terminal_status: string;
}

interface Props {
  productTypes: ProductType[];
  routes: Route[];
  onOpenCreateTerminalList: () => void;
  onSelectRoute: (routeId: number) => void;
  onStatusChanged: () => void;
}

export const InspectorView: React.FC<Props> = ({
  productTypes,
  routes,
  onOpenCreateTerminalList,
  onSelectRoute,
  onStatusChanged,
}) => {
  const [manualText, setManualText] = useState('');
  const [productTypeId, setProductTypeId] = useState(productTypes[0]?.id ?? 1);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matched, setMatched] = useState<MatchedWagon[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

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
          wagons: Array<{ wagon_id: number; wagon_number: string; terminal_status: string }>;
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
          });
        }
      }

      // Also scan locally loaded ACTIVE_ALL routes if candidates empty but routes prop has them
      if (!found.length) {
        for (const route of routes) {
          const detail = await api<{
            id: number;
            display_name: string;
            wagons: Array<{ wagon_id: number; wagon_number: string; terminal_status: string }>;
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
            });
          }
        }
      }

      setMatched(found);
      if (!found.length) setError(ru.inspector.empty);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
      setMatched([]);
    } finally {
      setIsParsing(false);
    }
  };

  const setStatus = async (row: MatchedWagon, status: TerminalStatus) => {
    setBusyKey(row.key);
    setIsSaving(true);
    setError(null);
    try {
      await api(`/api/routes/${row.route_id}/wagons/${row.wagon_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal_status: status }),
      });
      setMatched((prev) =>
        prev.map((m) => (m.key === row.key ? { ...m, terminal_status: status } : m)),
      );
      onStatusChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setBusyKey(null);
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 relative">
      {(isParsing || isSaving) && (
        <LoadingOverlay label={isParsing ? ru.loading.parse : ru.inspector.saving} />
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
        <p className="text-sm text-[var(--muted)]">{ru.inspector.pasteHint}</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <label className="lbl" htmlFor="inspector-product">{ru.createRoute.product}</label>
            <select
              id="inspector-product"
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
        <textarea
          className="field min-h-28"
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          placeholder={ru.createRoute.manualHint}
        />
        <button type="button" className="btn btn-secondary" onClick={findInRoutes} disabled={isParsing || !manualText.trim()}>
          {isParsing ? <Spinner /> : null} {ru.inspector.parse}
        </button>
      </div>

      {error && <div className="badge badge-err p-3 w-full justify-start">{error}</div>}

      <div className="card p-4">
        <h2 className="text-lg mb-3">{ru.inspector.statusNow}</h2>
        {matched.length === 0 ? (
          <div className="py-8 text-center">
            <p className="font-semibold">{ru.inspector.empty}</p>
            <p className="text-sm text-[var(--muted)] mt-1">{ru.inspector.emptyHint}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {matched.map((row) => (
              <li key={row.key} className="border border-[var(--line)] rounded-xl p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
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
                  <WagonStatusBadge status={row.terminal_status} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {INSPECTOR_STATUSES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      className={`btn tap ${row.terminal_status === s.value ? 'btn-primary' : 'btn-secondary'}`}
                      disabled={busyKey === row.key}
                      onClick={() => setStatus(row, s.value)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
