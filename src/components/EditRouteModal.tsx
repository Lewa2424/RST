import React, { useState } from 'react';
import { ProductType, Station, Route } from '../types';
import { ru } from '../i18n/ru';
import { api, ApiError } from '../api';
import { X } from 'lucide-react';
import { Spinner } from './LoadingState';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  route: Route;
  productTypes: ProductType[];
  stations: Station[];
  onSaved: () => void;
}

export function EditRouteModal({ isOpen, onClose, route, productTypes, stations, onSaved }: Props) {
  const [displayName, setDisplayName] = useState(route.display_name);
  const [productTypeId, setProductTypeId] = useState(route.product_type_id);
  const [stationId, setStationId] = useState<number | null>(route.station_id || null);
  const [routeDate, setRouteDate] = useState(route.route_date || '');
  const [notes, setNotes] = useState(route.notes || '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api(`/api/routes/${route.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName,
          product_type_id: productTypeId,
          station_id: stationId,
          route_date: routeDate,
          notes,
          updated_at: route.updated_at,
        }),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/35 flex items-end sm:items-center justify-center p-3">
      <div className="card w-full max-w-lg">
        <div className="flex justify-between p-4 border-b border-[var(--line)]">
          <h3>{ru.actions.edit}</h3>
          <button type="button" className="btn btn-ghost tap" onClick={onClose} aria-label={ru.actions.close}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="lbl">{ru.createRoute.displayName}</label>
            <input className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <label className="lbl">{ru.createRoute.product}</label>
            <select className="field" value={productTypeId} onChange={(e) => setProductTypeId(Number(e.target.value))}>
              {productTypes.map((pt) => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
            </select>
          </div>
          <div>
            <label className="lbl">{ru.createRoute.station}</label>
            <select className="field" value={stationId || ''} onChange={(e) => setStationId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="lbl">{ru.createRoute.date}</label>
            <input type="date" className="field" value={routeDate} onChange={(e) => setRouteDate(e.target.value)} />
          </div>
          <div>
            <label className="lbl">{ru.createRoute.notes}</label>
            <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <div className="badge badge-err p-3">{error}</div>}
        </div>
        <div className="p-4 flex justify-between border-t border-[var(--line)]">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{ru.actions.cancel}</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? <Spinner /> : null}
            {ru.actions.save}
          </button>
        </div>
      </div>
    </div>
  );
}
