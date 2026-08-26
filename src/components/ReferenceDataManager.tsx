import React, { useState } from 'react';
import { ProductType, Station } from '../types';
import { ru } from '../i18n/ru';
import { api, ApiError } from '../api';
import { X } from 'lucide-react';
import { Spinner } from './LoadingState';

interface Props {
  productTypes: ProductType[];
  stations: Station[];
  onRefreshData: () => void;
  initialModal?: 'TYPE' | 'STATION' | null;
}

export const ReferenceDataManager: React.FC<Props> = ({
  productTypes, stations, onRefreshData, initialModal = null,
}) => {
  const [tab, setTab] = useState<'types' | 'stations'>('types');
  const [modal, setModal] = useState<'TYPE' | 'STATION' | null>(initialModal);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { setError('Укажите наименование'); return; }
    setBusy(true); setError(null);
    try {
      if (modal === 'TYPE') await api('/api/product-types', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (modal === 'STATION') await api('/api/stations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      setModal(null); setName(''); onRefreshData();
    } catch (err) { setError(err instanceof ApiError ? err.message : ru.errors.generic); }
    finally { setBusy(false); }
  };

  const toggle = async (kind: 'types' | 'stations', id: number, active: number) => {
    const path = kind === 'types' ? `/api/product-types/${id}` : `/api/stations/${id}`;
    try {
      await api(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: active ? 0 : 1 }) });
      onRefreshData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ru.errors.generic);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-col sm:flex-row justify-between gap-3">
        <div>
          <h1 className="text-2xl">{ru.refs.title}</h1>
          <p className="text-sm text-[var(--muted)]">{ru.refs.usedHint}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => { setModal('TYPE'); setName(''); }}>{ru.refs.addType}</button>
          <button type="button" className="btn btn-secondary" onClick={() => { setModal('STATION'); setName(''); }}>{ru.refs.addStation}</button>
        </div>
      </div>
      <div className="chip-row">
        <button type="button" className={`btn whitespace-nowrap ${tab === 'types' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('types')}>{ru.refs.types}</button>
        <button type="button" className={`btn whitespace-nowrap ${tab === 'stations' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('stations')}>{ru.refs.stations}</button>
      </div>
      {error && <div className="badge badge-err p-3">{error}</div>}
      <div className="card p-4 space-y-2">
        {tab === 'types' && productTypes.map((pt) => (
          <div key={pt.id} className="flex items-center justify-between border-b border-[var(--line)] py-2 row-interactive px-2 rounded-lg">
            <span className="font-semibold">{pt.name}</span>
            <button type="button" className="btn btn-secondary" onClick={() => toggle('types', pt.id, pt.is_active)}>{pt.is_active ? ru.refs.deactivate : ru.refs.activate}</button>
          </div>
        ))}
        {tab === 'stations' && stations.map((s) => (
          <div key={s.id} className="flex items-center justify-between border-b border-[var(--line)] py-2 row-interactive px-2 rounded-lg">
            <span className="font-semibold">{s.name}</span>
            <button type="button" className="btn btn-secondary" onClick={() => toggle('stations', s.id, s.is_active)}>{s.is_active ? ru.refs.deactivate : ru.refs.activate}</button>
          </div>
        ))}
      </div>
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/35 flex items-end sm:items-center justify-center p-3">
          <div className="card w-full max-w-md">
            <div className="flex justify-between p-4 border-b border-[var(--line)]">
              <h3>{modal === 'TYPE' ? ru.refs.addType : ru.refs.addStation}</h3>
              <button type="button" className="btn btn-ghost tap" aria-label={ru.actions.close} onClick={() => setModal(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="lbl">{ru.refs.name}</label>
                <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
            <div className="p-4 flex justify-between border-t border-[var(--line)]">
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>{ru.actions.cancel}</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
                {busy ? <Spinner /> : null}
                {ru.actions.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
