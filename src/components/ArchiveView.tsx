import React, { useEffect, useState } from 'react';
import { ProductType, Station, Route } from '../types';
import { RouteListTable } from './RouteListTable';
import { ru } from '../i18n/ru';
import { api, asItems, ApiError } from '../api';

interface Props {
  productTypes: ProductType[];
  stations: Station[];
  onSelectRoute: (route: Route) => void;
  onUnarchiveRoute: (routeId: number) => void;
}

export const ArchiveView: React.FC<Props> = ({ productTypes, stations, onSelectRoute, onUnarchiveRoute }) => {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productTypeId, setProductTypeId] = useState('');
  const [stationId, setStationId] = useState('');
  const [status, setStatus] = useState('ARCHIVED');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = async () => {
    setLoading(true); setError(null);
    const qs = new URLSearchParams();
    if (productTypeId) qs.set('product_type_id', productTypeId);
    if (stationId) qs.set('station_id', stationId);
    if (status) qs.set('status', status);
    if (search) qs.set('search', search);
    if (dateFrom) qs.set('date_from', dateFrom);
    if (dateTo) qs.set('date_to', dateTo);
    try {
      const data = await api(`/api/archive?${qs.toString()}`);
      setRoutes(asItems<Route>(data));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [productTypeId, stationId, status, dateFrom, dateTo]);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h1 className="text-2xl">{ru.archive.title}</h1>
        <p className="text-[var(--muted)] mt-1">{ru.archive.subtitle}</p>
      </div>
      <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="lbl">{ru.createRoute.product}</label>
          <select className="field" value={productTypeId} onChange={(e) => setProductTypeId(e.target.value)}>
            <option value="">Все</option>
            {productTypes.map((pt) => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
          </select>
        </div>
        <div>
          <label className="lbl">{ru.createRoute.station}</label>
          <select className="field" value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">Все</option>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="lbl">{ru.archive.periodFrom}</label>
          <input type="date" className="field" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="lbl">{ru.archive.periodTo}</label>
          <input type="date" className="field" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div>
          <label className="lbl">{ru.archive.name}</label>
          <div className="flex gap-2">
            <input className="field" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button type="button" className="btn btn-secondary" onClick={load}>{ru.actions.search}</button>
          </div>
        </div>
      </div>
      {error && <div className="badge badge-err p-3">{error}</div>}
      <div className="card p-4">
        <RouteListTable
          routes={routes}
          loading={loading}
          onSelectRoute={onSelectRoute}
          onUnarchiveRoute={onUnarchiveRoute}
          emptyTitle={ru.archive.empty}
          emptyHint={ru.archive.subtitle}
        />
      </div>
    </div>
  );
};
