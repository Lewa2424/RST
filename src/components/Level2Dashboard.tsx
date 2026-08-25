import React from 'react';
import { ProductType, Station, Route, GlobalSummaryMetrics } from '../types';
import { RouteListTable } from './RouteListTable';
import { ArrowLeft, Plus } from 'lucide-react';
import { ru } from '../i18n/ru';

interface Props {
  selectedProductType: ProductType;
  stations: Station[];
  selectedStationId: number | null;
  setSelectedStationId: (id: number | null) => void;
  summary: GlobalSummaryMetrics | null;
  routes: Route[];
  loadingRoutes: boolean;
  onBackToLevel1: () => void;
  onOpenAddStationModal: () => void;
  onOpenCreateRoute: () => void;
  onOpenCreateTerminalList: () => void;
  onSelectRoute: (route: Route) => void;
  onEditRoute?: (route: Route) => void;
}

export const Level2Dashboard: React.FC<Props> = (props) => {
  const metrics = [
    [ru.level2.metrics.routes, props.summary?.active_routes_count || 0],
    [ru.level2.metrics.wagons, props.summary?.total_wagons_count || 0],
    [ru.level2.metrics.pending, props.summary?.pending_wagons_count || 0, 'wait'],
    [ru.level2.metrics.atTerminal, props.summary?.at_terminal_count || 0],
    [ru.level2.metrics.unloaded, props.summary?.unloaded_count || 0, 'ok'],
    [ru.level2.metrics.cleaned, props.summary?.cleaned_count || 0],
    [ru.level2.metrics.loaded, props.summary?.loaded_count || 0],
    [ru.level2.metrics.discrepancies, props.summary?.open_discrepancies_count || 0, 'err'],
  ] as const;

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" className="btn btn-secondary tap" onClick={props.onBackToLevel1} aria-label={ru.actions.back}>
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-2xl">{props.selectedProductType.name}</h1>
            <p className="text-sm text-[var(--muted)]">{ru.appFull}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={props.onOpenCreateRoute}>
            <Plus className="w-4 h-4" /> {ru.level2.createRoute}
          </button>
          <button type="button" className="btn btn-ghost" onClick={props.onOpenCreateTerminalList}>
            <Plus className="w-4 h-4" /> {ru.level2.createList}
          </button>
        </div>
      </div>

      <div className="card p-3">
        <label className="lbl" htmlFor="station-filter">{ru.level2.station}</label>
        <div className="flex gap-2">
          <select
            id="station-filter"
            className="field"
            value={props.selectedStationId || ''}
            onChange={(e) => props.setSelectedStationId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{ru.level2.allStations}</option>
            {props.stations.filter((s) => s.is_active).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" aria-label={ru.actions.add} onClick={props.onOpenAddStationModal}>
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {metrics.map(([label, value, tone]) => (
          <div key={label} className="card card-metric p-3">
            <div className="text-xs text-[var(--muted)]">{label}</div>
            <div className={`text-xl font-semibold ${tone === 'wait' ? 'text-[var(--wait)]' : tone === 'ok' ? 'text-[var(--ok)]' : tone === 'err' ? 'text-[var(--err)]' : ''}`}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <h2 className="text-lg mb-3">{ru.level2.activeRoutes}</h2>
        <RouteListTable
          routes={props.routes}
          loading={props.loadingRoutes}
          onSelectRoute={props.onSelectRoute}
          onEditRoute={props.onEditRoute}
        />
      </div>
    </div>
  );
};
