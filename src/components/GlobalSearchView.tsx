import React from 'react';
import { Route, SearchWagonResult } from '../types';
import { ru } from '../i18n/ru';
import { RouteStatusBadge, WagonStatusBadge, ChecksumBadge } from './StatusBadge';
import { LoadingState, Spinner } from './LoadingState';
import { formatWagonNumber } from '../../server/wagonUtils';
import { resolveInspectorPath } from '../../server/inspectorStatus';
import { InspectorStatusButtons } from './InspectorStatusPath';

interface Props {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onPerformSearch: () => void;
  searchResults: { routes: Route[]; wagon: SearchWagonResult | null } | null;
  loading: boolean;
  onSelectRoute: (route: Route) => void;
}

export const GlobalSearchView: React.FC<Props> = ({
  searchQuery, setSearchQuery, onPerformSearch, searchResults, loading, onSelectRoute,
}) => (
  <div className="space-y-4 max-w-3xl mx-auto">
    <div className="card p-5 space-y-3">
      <h1 className="text-2xl">{ru.search.title}</h1>
      <p className="text-[var(--muted)]">{ru.search.hint}</p>
      <form className="flex flex-col sm:flex-row gap-2" onSubmit={(e) => { e.preventDefault(); onPerformSearch(); }}>
        <label className="sr-only" htmlFor="search-q">{ru.search.title}</label>
        <input id="search-q" className="field flex-1" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={ru.search.placeholder} />
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? <Spinner /> : null}
          {ru.actions.search}
        </button>
      </form>
    </div>
    {loading && <LoadingState label={ru.search.searching} />}
    {searchResults && (
      <div className="space-y-4">
        {searchResults.wagon && (
          <div className="card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm text-[var(--muted)]">{ru.search.wagon}</div>
                <div className="wagon-no text-lg">{formatWagonNumber(searchResults.wagon.wagon_number)}</div>
              </div>
              <ChecksumBadge ok={Boolean(searchResults.wagon.is_checksum_valid)} wagonNumber={searchResults.wagon.wagon_number} />
            </div>
            <h2 className="font-semibold">{ru.search.routesOfWagon}</h2>
            <div className="space-y-2">
              {searchResults.wagon.routes.map((r) => (
                <button key={r.route_id} type="button" className="card card-interactive w-full text-left p-3" onClick={() => onSelectRoute({ id: r.route_id } as Route)}>
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{r.display_name}</span>
                    <RouteStatusBadge status={r.route_status} />
                  </div>
                  <p className="text-sm text-[var(--muted)]">{r.product_type_name} {r.station_name || ''}</p>
                  <div className="mt-2 space-y-2">
                    <WagonStatusBadge status={r.terminal_status} />
                    <InspectorStatusButtons path={resolveInspectorPath(r.inspector_statuses, r.terminal_status)} readOnly />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="card p-5">
          <h2 className="font-semibold mb-3">{ru.search.foundRoutes} ({searchResults.routes.length})</h2>
          {searchResults.routes.length === 0 ? (
            <p className="text-[var(--muted)]">{ru.search.none}</p>
          ) : (
            <div className="grid gap-2">
              {searchResults.routes.map((r) => (
                <button key={r.id} type="button" className="card card-interactive text-left p-3" onClick={() => onSelectRoute(r)}>
                  <div className="font-semibold">{r.display_name}</div>
                  <div className="text-sm text-[var(--muted)]">{r.product_type_name} · {r.processed_count}/{r.wagon_count}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )}
  </div>
);
