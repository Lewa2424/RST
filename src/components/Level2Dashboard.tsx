import React from 'react';
import { ProductType, Station, Route } from '../types';
import { RouteListTable } from './RouteListTable';
import { ArrowLeft, Plus } from 'lucide-react';
import { ru } from '../i18n/ru';

interface Props {
  selectedProductType: ProductType;
  stations: Station[];
  selectedStationId: number | null;
  setSelectedStationId: (id: number | null) => void;
  routes: Route[];
  loadingRoutes: boolean;
  onBackToLevel1: () => void;
  onOpenAddStationModal: () => void;
  onOpenCreateRoute: () => void;
  onOpenCreateTerminalList: () => void;
  onSelectRoute: (route: Route) => void;
  onEditRoute?: (route: Route) => void;
}

const OPEN_STATUSES = new Set(['ACTIVE', 'PARTIAL', 'HAS_DISCREPANCIES']);

export const Level2Dashboard: React.FC<Props> = (props) => {
  const openRoutes = props.routes.filter((r) => OPEN_STATUSES.has(r.status));
  const closedRoutes = props.routes.filter((r) => r.status === 'CLOSED');

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" className="btn btn-secondary tap" onClick={props.onBackToLevel1} aria-label={ru.actions.back}>
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-2xl">{props.selectedProductType.name}</h1>
            <p className="text-sm text-[var(--muted)]">{ru.level2.subtitle}</p>
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

      <div className="card p-4">
        <h2 className="text-lg mb-3">{ru.level2.openRoutes}</h2>
        <RouteListTable
          routes={openRoutes}
          loading={props.loadingRoutes}
          onSelectRoute={props.onSelectRoute}
          onEditRoute={props.onEditRoute}
          emptyTitle={ru.routes.emptyOpen}
          emptyHint={closedRoutes.length > 0 ? ru.routes.emptyOpenWithClosed : ru.routes.emptyHint}
        />
      </div>

      {closedRoutes.length > 0 && (
        <div className="card p-4">
          <h2 className="text-lg mb-1">{ru.level2.closedRoutes}</h2>
          <p className="text-sm text-[var(--muted)] mb-3">{ru.level2.closedHint}</p>
          <RouteListTable
            routes={closedRoutes}
            loading={false}
            onSelectRoute={props.onSelectRoute}
            onEditRoute={props.onEditRoute}
          />
        </div>
      )}
    </div>
  );
};
