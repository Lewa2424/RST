import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ru } from '../i18n/ru';
import { api } from '../api';
import { ChecksumBadge } from './StatusBadge';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  wagonNumber: string;
  weightKg?: number | null;
  terminalStatus?: string;
  notes?: string;
  onSave: (data: {
    parsed_wagon_number: string;
    weight_kg: number | null;
    terminal_status?: string;
    notes?: string;
    is_checksum_valid: boolean;
  }) => void;
}

export const PencilEditModal: React.FC<Props> = ({
  isOpen,
  onClose,
  wagonNumber: initialNumber,
  weightKg: initialWeight,
  terminalStatus: initialStatus,
  notes: initialNotes,
  onSave,
}) => {
  const [wagonNumber, setWagonNumber] = useState(initialNumber || '');
  const [weightKg, setWeightKg] = useState(initialWeight != null ? String(initialWeight) : '');
  const [terminalStatus, setTerminalStatus] = useState(initialStatus || 'NOT_AT_TERMINAL');
  const [notes, setNotes] = useState(initialNotes || '');
  const [checksum, setChecksum] = useState<{
    isValid: boolean;
    suggested_wagon_number?: string;
  } | null>(null);

  useEffect(() => {
    setWagonNumber(initialNumber || '');
    setWeightKg(initialWeight != null ? String(initialWeight) : '');
    setTerminalStatus(initialStatus || 'NOT_AT_TERMINAL');
    setNotes(initialNotes || '');
  }, [initialNumber, initialWeight, initialStatus, initialNotes, isOpen]);

  useEffect(() => {
    if (!isOpen || !wagonNumber.trim()) {
      setChecksum(null);
      return;
    }
    const t = setTimeout(() => {
      api<{ isValid: boolean; suggested_wagon_number?: string }>('/api/wagons/check-digit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wagon_number: wagonNumber }),
      })
        .then(setChecksum)
        .catch(() => setChecksum(null));
    }, 250);
    return () => clearTimeout(t);
  }, [wagonNumber, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/35 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-labelledby="pencil-title">
      <div className="card w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-[var(--line)]">
          <h3 id="pencil-title" className="text-lg">{ru.pencil.title}</h3>
          <button type="button" className="btn btn-ghost tap" aria-label={ru.actions.close} onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="lbl" htmlFor="pencil-wagon">{ru.pencil.wagon}</label>
            <input id="pencil-wagon" className="field wagon-no w-full" value={wagonNumber} onChange={(e) => setWagonNumber(e.target.value)} />
            {checksum && (
              <div className="mt-2">
                <ChecksumBadge
                  ok={checksum.isValid}
                  wagonNumber={wagonNumber}
                  suggestedNumber={checksum.suggested_wagon_number}
                />
              </div>
            )}
          </div>
          <div>
            <label className="lbl" htmlFor="pencil-weight">{ru.pencil.weight}</label>
            <input id="pencil-weight" className="field" inputMode="numeric" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
          </div>
          {initialStatus !== undefined && (
            <div>
              <label className="lbl" htmlFor="pencil-status">{ru.pencil.status}</label>
              <select id="pencil-status" className="field" value={terminalStatus} onChange={(e) => setTerminalStatus(e.target.value)}>
                <option value="NOT_AT_TERMINAL">{ru.status.NOT_AT_TERMINAL}</option>
                <option value="AT_TERMINAL">{ru.status.AT_TERMINAL}</option>
                <option value="UNLOADED">{ru.status.UNLOADED}</option>
                <option value="CLEANED">{ru.status.CLEANED}</option>
                <option value="LOADED">{ru.status.LOADED}</option>
                <option value="DEPARTED_LOADED">{ru.status.DEPARTED_LOADED}</option>
                <option value="DEPARTED_EMPTY">{ru.status.DEPARTED_EMPTY}</option>
              </select>
            </div>
          )}
          <div>
            <label className="lbl" htmlFor="pencil-notes">{ru.pencil.notes}</label>
            <input id="pencil-notes" className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {checksum && !checksum.isValid && (
            <p className="text-sm text-[var(--err)]">{ru.errors.checksumInvalid}</p>
          )}
        </div>
        <div className="p-4 flex justify-between border-t border-[var(--line)]">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{ru.actions.cancel}</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              onSave({
                parsed_wagon_number: wagonNumber.trim(),
                weight_kg: weightKg.trim() ? Number(weightKg.trim()) : null,
                ...(initialStatus !== undefined ? { terminal_status: terminalStatus } : {}),
                notes,
                is_checksum_valid: checksum?.isValid !== false,
              })
            }
          >
            {ru.actions.save}
          </button>
        </div>
      </div>
    </div>
  );
};
