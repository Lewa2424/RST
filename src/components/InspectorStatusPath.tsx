import React from 'react';
import { ru } from '../i18n/ru';
import { INSPECTOR_STATUSES, pathHasStatus, type InspectorStatus } from '../../server/inspectorStatus';

const LABELS: Record<InspectorStatus, string> = ru.inspector.statuses;

interface ButtonsProps {
  path: InspectorStatus[];
  disabled?: boolean;
  readOnly?: boolean;
  onSelect?: (status: InspectorStatus) => void;
}

export const InspectorStatusButtons: React.FC<ButtonsProps> = ({
  path,
  disabled,
  readOnly,
  onSelect,
}) => (
  <div className="chip-row">
    {INSPECTOR_STATUSES.map((status) => {
      const on = pathHasStatus(path, status);
      const className = `btn btn-chip ${on ? 'btn-status-on' : 'btn-secondary'}`;
      if (readOnly) {
        return (
          <span
            key={status}
            className={`${className} pointer-events-none`}
            aria-current={on ? 'true' : undefined}
          >
            {LABELS[status]}
          </span>
        );
      }
      return (
        <button
          key={status}
          type="button"
          className={className}
          disabled={disabled}
          aria-pressed={on}
          onClick={() => onSelect?.(status)}
        >
          {LABELS[status]}
        </button>
      );
    })}
  </div>
);

interface BatchBarProps {
  selectedCount: number;
  selectableCount: number;
  allSelected: boolean;
  busy?: boolean;
  onToggleAll: () => void;
  onApply: (status: InspectorStatus) => void;
}

export const InspectorBatchBar: React.FC<BatchBarProps> = ({
  selectedCount,
  selectableCount,
  allSelected,
  busy,
  onToggleAll,
  onApply,
}) => {
  if (selectableCount === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 min-h-[var(--tap)]">
          <input
            type="checkbox"
            className="inspector-check"
            checked={allSelected}
            disabled={busy}
            onChange={onToggleAll}
          />
          <span className="text-sm font-semibold">{ru.inspector.selectAll}</span>
        </label>
        <span className="text-sm text-[var(--muted)]">
          {ru.inspector.selectedCount.replace('{count}', String(selectedCount))}
        </span>
      </div>
      <p className="text-sm text-[var(--muted)]">
        {selectedCount > 0 ? ru.inspector.batchHint : ru.inspector.batchNeedSelection}
      </p>
      <InspectorStatusButtons
        path={[]}
        disabled={busy || selectedCount === 0}
        onSelect={onApply}
      />
    </div>
  );
};
