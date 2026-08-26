import React, { useEffect, useState } from 'react';
import { ProductType, Station, ParsedRowCandidate } from '../types';
import { PencilEditModal } from './PencilEditModal';
import { ImagePagesPicker, type ImagePage } from './ImagePagesPicker';
import { ChecksumBadge } from './StatusBadge';
import { LoadingOverlay, Spinner } from './LoadingState';
import { X, FileText, FileSpreadsheet, Camera, Pencil, Trash2 } from 'lucide-react';
import { ru } from '../i18n/ru';
import { api, asParseRows, ApiError } from '../api';
import { formatWagonNumber } from '../../server/wagonUtils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  productTypes: ProductType[];
  stations: Station[];
  initialProductTypeId?: number | null;
  appendToRouteId?: number | null;
  onSuccess: (newRoute: unknown) => void;
}

function previewRowClass(row: ParsedRowCandidate): string {
  if (!row.is_checksum_valid || row.is_duplicate) return 'bg-[var(--err-soft)]';
  if (row.doubtful || (row.parsing_confidence != null && row.parsing_confidence < 0.75)) {
    return 'bg-[var(--wait-soft)]';
  }
  return '';
}

export const CreateRouteModal: React.FC<Props> = ({
  isOpen,
  onClose,
  productTypes,
  stations,
  initialProductTypeId,
  appendToRouteId,
  onSuccess,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [displayName, setDisplayName] = useState('');
  const [productTypeId, setProductTypeId] = useState<number>(initialProductTypeId || productTypes[0]?.id || 1);
  const [stationId, setStationId] = useState<number | null>(null);
  const [routeDate, setRouteDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [importMethod, setImportMethod] = useState<'MANUAL' | 'EXCEL' | 'WORD' | 'IMAGE'>('MANUAL');
  const [manualText, setManualText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<ParsedRowCandidate[]>([]);
  const [unrecognized, setUnrecognized] = useState<Array<{ source_row: number; text: string }>>([]);
  const [editingRow, setEditingRow] = useState<{ row: ParsedRowCandidate; index: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pages, setPages] = useState<ImagePage[]>([]);
  const [excelMeta, setExcelMeta] = useState<{
    file: File | null;
    sheets: string[];
    sheet: string;
    wagonCol: string;
    weightCol: string;
  }>({ file: null, sheets: [], sheet: '', wagonCol: '', weightCol: '' });

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setDisplayName('');
    setProductTypeId(initialProductTypeId || productTypes[0]?.id || 1);
    setStationId(null);
    setRouteDate(new Date().toISOString().split('T')[0]);
    setNotes('');
    setImportMethod('MANUAL');
    setManualText('');
    setParseError(null);
    setPreviewRows([]);
    setUnrecognized([]);
    setPages([]);
    setExcelMeta({ file: null, sheets: [], sheet: '', wagonCol: '', weightCol: '' });
  }, [isOpen, appendToRouteId, initialProductTypeId]);

  if (!isOpen) return null;

  const isAppend = Boolean(appendToRouteId);
  const waitLabel = isSubmitting
    ? ru.loading.save
    : importMethod === 'IMAGE'
      ? ru.loading.ocr
      : importMethod === 'EXCEL'
        ? ru.loading.excel
        : importMethod === 'WORD'
          ? ru.loading.word
          : ru.loading.parse;

  const applyParsed = (payload: unknown) => {
    const parsed = asParseRows(payload);
    setPreviewRows(parsed.rows as ParsedRowCandidate[]);
    setUnrecognized(parsed.unrecognized as Array<{ source_row: number; text: string }>);
    if (parsed.sheets?.length) {
      setExcelMeta((m) => ({
        ...m,
        sheets: parsed.sheets || [],
        sheet: parsed.selected_sheet || parsed.sheets?.[0] || '',
        wagonCol: parsed.guessed_columns?.wagon != null ? String(parsed.guessed_columns.wagon) : '',
        weightCol: parsed.guessed_columns?.weight != null ? String(parsed.guessed_columns.weight) : '',
      }));
    }
    setStep(2);
  };

  const handleParseText = async () => {
    if (!manualText.trim()) return;
    setIsParsing(true);
    setParseError(null);
    try {
      applyParsed(await api('/api/imports/parse-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: manualText, entity_type: 'ROUTE' }),
      }));
    } catch (err) {
      setParseError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setIsParsing(false);
    }
  };

  const parseExcel = async (file: File, extra?: Record<string, string>) => {
    setIsParsing(true);
    setParseError(null);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entity_type', 'ROUTE');
    if (extra?.sheet_name) formData.append('sheet_name', extra.sheet_name);
    if (extra?.wagon_col) formData.append('wagon_col', extra.wagon_col);
    if (extra?.weight_col) formData.append('weight_col', extra.weight_col);
    try {
      applyParsed(await api('/api/imports/excel', { method: 'POST', body: formData }));
    } catch (err) {
      setParseError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setIsParsing(false);
    }
  };

  const handleWord = async (file: File) => {
    setIsParsing(true);
    setParseError(null);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entity_type', 'ROUTE');
    try {
      applyParsed(await api('/api/imports/word', { method: 'POST', body: formData }));
    } catch (err) {
      setParseError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setIsParsing(false);
    }
  };

  const handleImages = async () => {
    if (pages.length === 0) return;
    setIsParsing(true);
    setParseError(null);
    const formData = new FormData();
    pages.forEach((p) => formData.append('images', p.file));
    formData.append('entity_type', 'ROUTE');
    try {
      applyParsed(await api('/api/imports/images', { method: 'POST', body: formData }));
    } catch (err) {
      setParseError(err instanceof ApiError ? err.message : ru.errors.generic);
      setImportMethod('MANUAL');
    } finally {
      setIsParsing(false);
    }
  };

  const handleFinalSave = async () => {
    if (!isAppend && !displayName.trim()) {
      setParseError(ru.errors.needName);
      return;
    }
    if (previewRows.length === 0) {
      setParseError(ru.errors.emptyWagons);
      return;
    }
    setIsSubmitting(true);
    setParseError(null);
    try {
      const data = isAppend
        ? await api(`/api/routes/${appendToRouteId}/wagons`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wagons: previewRows }),
          })
        : await api('/api/routes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              display_name: displayName,
              product_type_id: productTypeId,
              station_id: stationId,
              route_date: routeDate,
              notes,
              wagons: previewRows,
            }),
          });
      onSuccess(data);
      onClose();
    } catch (err) {
      setParseError(err instanceof ApiError ? err.message : ru.errors.generic);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="card modal-sheet max-w-4xl relative">
        {(isParsing || isSubmitting) && <LoadingOverlay label={waitLabel} />}
        <div className="modal-sheet-header flex items-center justify-between p-4 border-b border-[var(--line)]">
          <div>
            <h3 className="text-lg">{isAppend ? ru.createRoute.addTitle : ru.createRoute.title}</h3>
            <p className="text-sm text-[var(--muted)]">{step === 1 ? ru.createRoute.step1 : ru.createRoute.step2}</p>
          </div>
          <button type="button" className="btn btn-ghost tap" aria-label={ru.actions.close} onClick={onClose}><X className="w-5 h-5" /></button>
        </div>

        <div className="modal-sheet-body p-4 space-y-4">
          {step === 1 ? (
            <>
              {!isAppend && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="lbl" htmlFor="route-name">{ru.createRoute.displayName}</label>
                    <input id="route-name" className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={ru.createRoute.displayNamePh} />
                  </div>
                  <div>
                    <label className="lbl" htmlFor="route-date">{ru.createRoute.date}</label>
                    <input id="route-date" type="date" className="field" value={routeDate} onChange={(e) => setRouteDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="lbl" htmlFor="route-product">{ru.createRoute.product}</label>
                    <select id="route-product" className="field" value={productTypeId} onChange={(e) => setProductTypeId(Number(e.target.value))}>
                      {productTypes.map((pt) => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="lbl" htmlFor="route-station">{ru.createRoute.station}</label>
                    <select id="route-station" className="field" value={stationId || ''} onChange={(e) => setStationId(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">—</option>
                      {stations.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="lbl" htmlFor="route-notes">{ru.createRoute.notes}</label>
                    <input id="route-notes" className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </div>
              )}

              <fieldset>
                <legend className="lbl">{ru.createRoute.method}</legend>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    ['MANUAL', ru.createRoute.manual, FileText],
                    ['EXCEL', ru.createRoute.excel, FileSpreadsheet],
                    ['WORD', ru.createRoute.word, FileText],
                    ['IMAGE', ru.createRoute.image, Camera],
                  ].map(([id, label, Icon]) => (
                    <button
                      key={String(id)}
                      type="button"
                      className={`btn ${importMethod === id ? 'btn-primary' : 'btn-secondary'} flex-col h-auto py-3`}
                      onClick={() => setImportMethod(id as typeof importMethod)}
                    >
                      <Icon className="w-4 h-4" />
                      {String(label)}
                    </button>
                  ))}
                </div>
              </fieldset>

              {importMethod === 'MANUAL' && (
                <div className="space-y-2">
                  <p className="text-sm text-[var(--muted)]">{ru.createRoute.manualHint}</p>
                  <textarea className="field min-h-32" value={manualText} onChange={(e) => setManualText(e.target.value)} />
                  <button type="button" className="btn btn-primary" disabled={isParsing} onClick={handleParseText}>
                    {isParsing ? <Spinner /> : null}
                    {ru.actions.parse}
                  </button>
                </div>
              )}
              {importMethod === 'EXCEL' && (
                <div className="space-y-2">
                  <input type="file" accept=".xlsx,.xls" className="field" aria-label={ru.createRoute.excel} onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setExcelMeta((m) => ({ ...m, file }));
                    parseExcel(file);
                  }} />
                </div>
              )}
              {importMethod === 'WORD' && (
                <input type="file" accept=".docx" className="field" aria-label={ru.createRoute.word} onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleWord(file);
                }} />
              )}
              {importMethod === 'IMAGE' && (
                <div className="space-y-3">
                  <ImagePagesPicker pages={pages} onChange={setPages} />
                  <button type="button" className="btn btn-primary" disabled={isParsing || pages.length === 0} onClick={handleImages}>
                    {isParsing ? <Spinner /> : null}
                    {ru.images.recognize}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              {excelMeta.file && (
                <div className="card p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="lbl">{ru.excel.sheet}</label>
                    <select className="field" value={excelMeta.sheet} onChange={(e) => setExcelMeta((m) => ({ ...m, sheet: e.target.value }))}>
                      {excelMeta.sheets.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="lbl">{ru.excel.wagonCol}</label>
                    <input className="field" value={excelMeta.wagonCol} onChange={(e) => setExcelMeta((m) => ({ ...m, wagonCol: e.target.value }))} placeholder={ru.excel.auto} />
                  </div>
                  <div>
                    <label className="lbl">{ru.excel.weightCol}</label>
                    <input className="field" value={excelMeta.weightCol} onChange={(e) => setExcelMeta((m) => ({ ...m, weightCol: e.target.value }))} placeholder={ru.excel.auto} />
                  </div>
                  <button type="button" className="btn btn-secondary sm:col-span-3" onClick={() => excelMeta.file && parseExcel(excelMeta.file, {
                    sheet_name: excelMeta.sheet,
                    wagon_col: excelMeta.wagonCol,
                    weight_col: excelMeta.weightCol,
                  })}>{ru.excel.apply}</button>
                </div>
              )}
              <div className="flex justify-between items-center">
                <h4 className="font-semibold">{ru.createRoute.preview} ({previewRows.length})</h4>
                <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>{ru.actions.back}</button>
              </div>
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[var(--muted)] border-b border-[var(--line)]">
                      <th className="py-2">№</th>
                      <th>Вагон</th>
                      <th>КС</th>
                      <th>Масса</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, idx) => (
                      <tr key={idx} className={`border-b border-[var(--line)] row-interactive ${previewRowClass(r)}`}>
                        <td className="py-2">{idx + 1}</td>
                        <td><span className="wagon-no">{formatWagonNumber(r.parsed_wagon_number || r.raw_wagon_number)}</span></td>
                        <td>
                          <ChecksumBadge ok={r.is_checksum_valid} wagonNumber={r.parsed_wagon_number || r.raw_wagon_number} suggestedNumber={r.suggested_wagon_number} />
                          {r.is_duplicate ? <div className="text-xs text-[var(--err)]">{ru.discrepancy.DUPLICATE_IN_INPUT}</div> : null}
                        </td>
                        <td>{r.weight_kg ? `${r.weight_kg.toLocaleString('ru-RU')} кг` : '—'}</td>
                        <td className="text-right">
                          <button type="button" className="btn btn-ghost tap" aria-label={ru.actions.edit} onClick={() => setEditingRow({ row: r, index: idx })}><Pencil className="w-4 h-4" /></button>
                          <button type="button" className="btn btn-ghost tap" aria-label={ru.actions.delete} onClick={() => setPreviewRows((p) => p.filter((_, i) => i !== idx))}><Trash2 className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {unrecognized.length > 0 && (
                <div className="text-sm">
                  <p className="font-semibold">{ru.createRoute.unrecognized}</p>
                  <ul className="text-[var(--muted)]">{unrecognized.map((u, i) => <li key={i}>{u.source_row}: {u.text}</li>)}</ul>
                </div>
              )}
            </div>
          )}
          {parseError && <div className="badge badge-err w-full justify-start p-3">{parseError}</div>}
        </div>

        <div className="modal-sheet-footer p-4 flex justify-between border-t border-[var(--line)]">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{ru.actions.cancel}</button>
          {step === 2 && (
            <button type="button" className="btn btn-primary" disabled={isSubmitting} onClick={handleFinalSave}>
              {isSubmitting ? <Spinner /> : null}
              {isAppend ? ru.createRoute.saveAdd : ru.createRoute.save}
            </button>
          )}
        </div>
      </div>

      {editingRow && (
        <PencilEditModal
          isOpen
          onClose={() => setEditingRow(null)}
          wagonNumber={editingRow.row.parsed_wagon_number || editingRow.row.raw_wagon_number}
          weightKg={editingRow.row.weight_kg}
          onSave={(updated) => {
            const next = [...previewRows];
            next[editingRow.index] = {
              ...next[editingRow.index],
              parsed_wagon_number: updated.parsed_wagon_number,
              raw_wagon_number: updated.parsed_wagon_number,
              weight_kg: updated.weight_kg,
              is_checksum_valid: updated.is_checksum_valid,
              doubtful: !updated.is_checksum_valid,
              is_duplicate: false,
            };
            setPreviewRows(next);
            setEditingRow(null);
          }}
        />
      )}
    </div>
  );
};
