import React from 'react';
import { Route } from '../types';
import { RouteStatusBadge } from './StatusBadge';
import { ru } from '../i18n/ru';
import { Pencil } from 'lucide-react';
import { LoadingState } from './LoadingState';

interface Props {
  routes: Route[];
  loading: boolean;
  onSelectRoute: (route: Route) => void;
  onEditRoute?: (route: Route) => void;
  onUnarchiveRoute?: (routeId: number) => void;
  emptyTitle?: string;
  emptyHint?: string;
}

export const RouteListTable: React.FC<Props> = ({
  routes, loading, onSelectRoute, onEditRoute, onUnarchiveRoute,
  emptyTitle = ru.routes.empty, emptyHint = ru.routes.emptyHint,
}) => {
  if (loading) return <LoadingState label={ru.routes.loading} skeletons={2} />;
  if (routes.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="font-semibold">{emptyTitle}</p>
        <p className="text-sm text-[var(--muted)] mt-1">{emptyHint}</p>
      </div>
    );
  }

  return (
    <>
      <div className="md:hidden space-y-3">
        {routes.map((route) => {
          const remaining = Math.max(0, route.wagon_count - route.processed_count);
          return (
            <article key={route.id} className="card card-interactive p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="text-left" onClick={() => onSelectRoute(route)}>
                  <h3 className="font-semibold">{route.display_name}</h3>
                  <p className="text-xs text-[var(--muted)]">{route.internal_code}</p>
                </button>
                <RouteStatusBadge status={route.status} />
              </div>
              <p className="text-sm text-[var(--muted)]">
                {route.product_type_name}
                {route.station_name ? ` · ${route.station_name}` : ''}
              </p>
              <p className="text-sm">
                {route.processed_count} / {route.wagon_count} · {ru.routes.remaining}: {remaining}
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary flex-1" onClick={() => onSelectRoute(route)}>
                  {ru.actions.open}
                </button>
                {onUnarchiveRoute && (
                  <button type="button" className="btn btn-secondary flex-1" onClick={() => onUnarchiveRoute(route.id)}>
                    {ru.routes.restore}
                  </button>
                )}
                {onEditRoute && (
                  <button type="button" className="btn btn-secondary" aria-label={ru.actions.edit} onClick={() => onEditRoute(route)}>
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="hidden md:block table-scroll">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-[var(--muted)] border-b border-[var(--line)]">
              <th className="py-3 pr-3">{ru.routes.name}</th>
              <th className="py-3 pr-3">{ru.routes.date}</th>
              <th className="py-3 pr-3">{ru.routes.product}</th>
              <th className="py-3 pr-3">{ru.routes.station}</th>
              <th className="py-3 pr-3">{ru.routes.progress}</th>
              <th className="py-3 pr-3">{ru.routes.status}</th>
              <th className="py-3 text-right"> </th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => {
              const remaining = Math.max(0, route.wagon_count - route.processed_count);
              return (
                <tr key={route.id} className="border-b border-[var(--line)] align-top row-interactive">
                  <td className="py-3 pr-3">
                    <button type="button" className="text-left font-semibold" onClick={() => onSelectRoute(route)}>
                      {route.display_name}
                    </button>
                    <div className="text-xs text-[var(--muted)]">{route.internal_code}</div>
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap">{route.route_date || '—'}</td>
                  <td className="py-3 pr-3">{route.product_type_name}</td>
                  <td className="py-3 pr-3">{route.station_name || '—'}</td>
                  <td className="py-3 pr-3">
                    {route.processed_count} / {route.wagon_count}
                    {remaining > 0 && <div className="text-xs text-[var(--wait)]">{ru.routes.remaining}: {remaining}</div>}
                  </td>
                  <td className="py-3 pr-3"><RouteStatusBadge status={route.status} /></td>
                  <td className="py-3 text-right whitespace-nowrap">
                    {onUnarchiveRoute && (
                      <button type="button" className="btn btn-secondary" onClick={() => onUnarchiveRoute(route.id)}>
                        {ru.routes.restore}
                      </button>
                    )}
                    {onEditRoute && (
                      <button type="button" className="btn btn-ghost" aria-label={ru.actions.edit} onClick={() => onEditRoute(route)}>
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    <button type="button" className="btn btn-secondary" onClick={() => onSelectRoute(route)}>
                      {ru.actions.open}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};
