import React, { useEffect, useState } from 'react';
import { ProductType, Station, Route, ParsedRowCandidate } from '../types';
import { PencilEditModal } from './PencilEditModal';
import { ImagePagesPicker, type ImagePage } from './ImagePagesPicker';
import { ChecksumBadge } from './StatusBadge';
import { LoadingOverlay, Spinner } from './LoadingState';
import { X, Pencil, Trash2 } from 'lucide-react';
import { ru } from '../i18n/ru';
import { api, asParseRows, ApiError } from '../api';
import { formatWagonNumber } from '../../server/wagonUtils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  productTypes: ProductType[];
  stations: Station[];
  routes: Route[];
  preSelectedRouteId?: number | null;
  onSuccess: (newList: unknown) => void;
}

export const CreateTerminalListModal: React.FC<Props> = ({
  isOpen, onClose, productTypes, stations, routes, preSelectedRouteId, onSuccess,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [displayName, setDisplayName] = useState('');
  const [productTypeId, setProductTypeId] = useState(productTypes[0]?.id ?? 1);
  const [stationId, setStationId] = useState<number | null>(null);
  const [routeId, setRouteId] = useState<number | null>(preSelectedRouteId || null);
  const [operationType, setOperationType] = useState('UNLOADING');
  const [listDate, setListDate] = useState(new Date().toISOString().split('T')[0]);
  const [importMethod, setImportMethod] = useState<'MANUAL' | 'EXCEL' | 'WORD' | 'IMAGE'>('MANUAL');
  const [manualText, setManualText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Array<{ id: number; display_name: string; matches: number; total_in_route: number }>>([]);
  const [previewRows, setPreviewRows] = useState<ParsedRowCandidate[]>([]);
  const [editingRow, setEditingRow] = useState<{ row: ParsedRowCandidate; index: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pages, setPages] = useState<ImagePage[]>([]);

  useEffect(() => {
    if (isOpen) setRouteId(preSelectedRouteId || null);
  }, [isOpen, preSelectedRouteId]);

  if (!isOpen) return null;
  const waitLabel = isSubmitting
    ? ru.loading.save
    : importMethod === 'IMAGE'
      ? ru.loading.ocr
      : importMethod === 'EXCEL'
        ? ru.loading.excel
        : importMethod === 'WORD'
          ? ru.loading.word
          : ru.loading.parse;

  const loadCandidates = async (rows: ParsedRowCandidate[]) => {
    const numbers = rows.map((r) => r.parsed_wagon_number || r.raw_wagon_number).filter(Boolean);
    if (!numbers.length) return;
    try {
      const data = await api<typeof candidates>('/api/terminal-lists/match-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_type_id: productTypeId, wagon_numbers: numbers }),
      });
      setCandidates(Array.isArray(data) ? data : []);
    } catch {
      setCandidates([]);
    }
  };

  const applyParsed = async (payload: unknown) => {
    const parsed = asParseRows(payload);
    const rows = parsed.rows as ParsedRowCandidate[];
    setPreviewRows(rows);
    await loadCandidates(rows);
    setStep(2);
  };

  const parseText = async () => {
    setIsParsing(true); setParseError(null);
    try {
      await applyParsed(await api('/api/imports/parse-text', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: manualText, entity_type: 'TERMINAL_LIST' }),
      }));
    } catch (err) { setParseError(err instanceof ApiError ? err.message : ru.errors.generic); }
    finally { setIsParsing(false); }
  };

  const uploadNamed = async (path: string, file: File) => {
    setIsParsing(true); setParseError(null);
    const fd = new FormData(); fd.append('file', file); fd.append('entity_type', 'TERMINAL_LIST');
    try { await applyParsed(await api(path, { method: 'POST', body: fd })); }
    catch (err) { setParseError(err instanceof ApiError ? err.message : ru.errors.generic); }
    finally { setIsParsing(false); }
  };

  const handleImages = async () => {
    if (!pages.length) return;
    setIsParsing(true); setParseError(null);
    const fd = new FormData();
    pages.forEach((p) => fd.append('images', p.file));
    fd.append('entity_type', 'TERMINAL_LIST');
    try { await applyParsed(await api('/api/imports/images', { method: 'POST', body: fd })); }
    catch (err) { setParseError(err instanceof ApiError ? err.message : ru.errors.generic); setImportMethod('MANUAL'); }
    finally { setIsParsing(false); }
  };

  const handleSave = async () => {
    if (!previewRows.length) { setParseError(ru.errors.emptyWagons); return; }
    setIsSubmitting(true); setParseError(null);
    try {
      const data = await api('/api/terminal-lists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          route_id: routeId, product_type_id: productTypeId, station_id: stationId,
          display_name: displayName, operation_type: operationType, list_date: listDate, import_method: importMethod,
          confirm_now: true, rows: previewRows,
        }),
      });
      onSuccess(data); onClose();
    } catch (err) { setParseError(err instanceof ApiError ? err.message : ru.errors.generic); }
    finally { setIsSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/35 flex items-end sm:items-center justify-center p-3 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="card w-full max-w-4xl my-4 relative overflow-hidden">
        {(isParsing || isSubmitting) && <LoadingOverlay label={waitLabel} />}
        <div className="flex items-center justify-between p-4 border-b border-[var(--line)]">
          <div>
            <h3 className="text-lg">{ru.createList.title}</h3>
            <p className="text-sm text-[var(--muted)]">{ru.createList.subtitle}</p>
            <p className="text-sm text-[var(--muted)] mt-1">{step === 1 ? ru.createList.step1 : ru.createList.step2}</p>
          </div>
          <button type="button" className="btn btn-ghost tap" aria-label={ru.actions.close} onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
          {step === 1 ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="lbl">{ru.createList.bindRoute}</label>
                  <select className="field" value={routeId || ''} onChange={(e) => setRouteId(e.target.value ? Number(e.target.value) : null)}>
                    {routes.map((r) => <option key={r.id} value={r.id}>{r.display_name}</option>)}
                    <option value="">{ru.createList.bindNone}</option>
                  </select>
                  <p className="text-xs text-[var(--muted)] mt-1">{ru.createList.bindHint}</p>
                </div>
                <div>
                  <label className="lbl" htmlFor="op">{ru.createList.operation}</label>
                  <select id="op" className="field" value={operationType} onChange={(e) => setOperationType(e.target.value)}>
                    <option value="UNLOADING">{ru.status.UNLOADING}</option>
                    <option value="CLEANING">{ru.status.CLEANING}</option>
                    <option value="LOADING">{ru.status.LOADING}</option>
                    <option value="DEPARTURE_LOADED">{ru.status.DEPARTURE_LOADED}</option>
                    <option value="DEPARTURE_EMPTY">{ru.status.DEPARTURE_EMPTY}</option>
                  </select>
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
                    {stations.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="lbl">{ru.createRoute.date}</label>
                  <input type="date" className="field" value={listDate} onChange={(e) => setListDate(e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className="lbl">{ru.createList.name}</label>
                  <input className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {([['MANUAL', ru.createRoute.manual], ['EXCEL', ru.createRoute.excel], ['WORD', ru.createRoute.word], ['IMAGE', ru.createRoute.image]] as const).map(([id, label]) => (
                  <button key={id} type="button" className={`btn ${importMethod === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setImportMethod(id)}>{label}</button>
                ))}
              </div>
              {importMethod === 'MANUAL' && (
                <div className="space-y-2">
                  <textarea className="field min-h-32" value={manualText} onChange={(e) => setManualText(e.target.value)} />
                  <button type="button" className="btn btn-primary" disabled={isParsing} onClick={parseText}>
                    {isParsing ? <Spinner /> : null}
                    {ru.actions.parse}
                  </button>
                </div>
              )}
              {importMethod === 'EXCEL' && <input type="file" accept=".xlsx,.xls" className="field" onChange={(e) => e.target.files?.[0] && uploadNamed('/api/imports/excel', e.target.files[0])} />}
              {importMethod === 'WORD' && <input type="file" accept=".docx" className="field" onChange={(e) => e.target.files?.[0] && uploadNamed('/api/imports/word', e.target.files[0])} />}
              {importMethod === 'IMAGE' && (
                <div className="space-y-2">
                  <ImagePagesPicker pages={pages} onChange={setPages} />
                  <button type="button" className="btn btn-primary" disabled={isParsing || !pages.length} onClick={handleImages}>
                    {isParsing ? <Spinner /> : null}
                    {ru.images.recognize}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              {candidates.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">{ru.createList.candidates}</h4>
                  <div className="grid gap-2">
                    {candidates.map((c) => (
                      <button key={c.id} type="button" className={`btn ${routeId === c.id ? 'btn-primary' : 'btn-secondary'} justify-between`} onClick={() => setRouteId(c.id)}>
                        <span>{c.display_name}</span>
                        <span>{c.matches} {ru.createList.matches} / {c.total_in_route}</span>
                      </button>
                    ))}
                    <button type="button" className={`btn btn-ghost ${routeId === null ? 'ring-1 ring-[var(--line)]' : ''}`} onClick={() => setRouteId(null)}>
                      {ru.createList.bindNone}
                    </button>
                  </div>
                </div>
              )}
              <div className="flex justify-between">
                <h4 className="font-semibold">{previewRows.length} ваг.</h4>
                <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>{ru.actions.back}</button>
              </div>
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <tbody>
                    {previewRows.map((r, idx) => (
                      <tr key={idx} className={`border-b border-[var(--line)] row-interactive ${!r.is_checksum_valid || r.is_duplicate ? 'bg-[var(--err-soft)]' : ''}`}>
                        <td className="py-2">{idx + 1}</td>
                        <td><span className="wagon-no">{formatWagonNumber(r.parsed_wagon_number || r.raw_wagon_number)}</span></td>
                        <td><ChecksumBadge ok={r.is_checksum_valid} wagonNumber={r.parsed_wagon_number || r.raw_wagon_number} suggestedNumber={r.suggested_wagon_number} /></td>
                        <td>{r.weight_kg ? `${r.weight_kg.toLocaleString('ru-RU')} кг` : '—'}</td>
                        <td>
                          <button type="button" className="btn btn-ghost tap" aria-label={ru.actions.edit} onClick={() => setEditingRow({ row: r, index: idx })}><Pencil className="w-4 h-4" /></button>
                          <button type="button" className="btn btn-ghost tap" aria-label={ru.actions.delete} onClick={() => setPreviewRows((p) => p.filter((_, i) => i !== idx))}><Trash2 className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {parseError && <div className="badge badge-err p-3 w-full justify-start">{parseError}</div>}
        </div>
        <div className="p-4 flex justify-between border-t border-[var(--line)]">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{ru.actions.cancel}</button>
          {step === 2 && (
            <button type="button" className="btn btn-primary" disabled={isSubmitting} onClick={handleSave}>
              {isSubmitting ? <Spinner /> : null}
              {ru.createList.save}
            </button>
          )}
        </div>
      </div>
      {editingRow && (
        <PencilEditModal isOpen onClose={() => setEditingRow(null)} wagonNumber={editingRow.row.parsed_wagon_number || editingRow.row.raw_wagon_number} weightKg={editingRow.row.weight_kg} onSave={(u) => {
          const next = [...previewRows];
          next[editingRow.index] = {
            ...next[editingRow.index],
            parsed_wagon_number: u.parsed_wagon_number,
            raw_wagon_number: u.parsed_wagon_number,
            weight_kg: u.weight_kg,
            is_checksum_valid: u.is_checksum_valid,
            doubtful: !u.is_checksum_valid,
          };
          setPreviewRows(next); setEditingRow(null);
        }} />
      )}
    </div>
  );
};
