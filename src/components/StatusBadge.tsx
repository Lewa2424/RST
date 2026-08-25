import React from 'react';
import { ru } from '../i18n/ru';
import type { RouteStatus, TerminalStatus } from '../types';
import { formatWagonNumber, suggestCorrectedWagonNumber } from '../../server/wagonUtils';

const routeMap: Record<string, { cls: string; label: string }> = {
  ACTIVE: { cls: 'badge-steel', label: ru.status.ACTIVE },
  PARTIAL: { cls: 'badge-wait', label: ru.status.PARTIAL },
  CLOSED: { cls: 'badge-ok', label: ru.status.CLOSED },
  HAS_DISCREPANCIES: { cls: 'badge-err', label: ru.status.HAS_DISCREPANCIES },
  ARCHIVED: { cls: 'badge-idle', label: ru.status.ARCHIVED },
};

const wagonMap: Record<string, { cls: string; label: string }> = {
  NOT_AT_TERMINAL: { cls: 'badge-idle', label: ru.status.NOT_AT_TERMINAL },
  AT_TERMINAL: { cls: 'badge-steel', label: ru.status.AT_TERMINAL },
  UNLOADED: { cls: 'badge-ok', label: ru.status.UNLOADED },
  CLEANED: { cls: 'badge-steel', label: ru.status.CLEANED },
  LOADED: { cls: 'badge-wait', label: ru.status.LOADED },
  DEPARTED_LOADED: { cls: 'badge-ok', label: ru.status.DEPARTED_LOADED },
  DEPARTED_EMPTY: { cls: 'badge-idle', label: ru.status.DEPARTED_EMPTY },
};

export function RouteStatusBadge({ status }: { status: RouteStatus | string }) {
  const item = routeMap[status] || routeMap.ACTIVE;
  return (
    <span className={`badge ${item.cls}`}>
      <span aria-hidden="true">●</span>
      {item.label}
    </span>
  );
}

export function WagonStatusBadge({ status }: { status: TerminalStatus | string }) {
  const item = wagonMap[status] || wagonMap.NOT_AT_TERMINAL;
  return <span className={`badge ${item.cls}`}>{item.label}</span>;
}

export function ChecksumBadge({
  ok,
  wagonNumber,
  suggestedNumber,
}: {
  ok: boolean;
  wagonNumber?: string | null;
  suggestedNumber?: string | null;
}) {
  const suggested =
    suggestedNumber ||
    (!ok && wagonNumber ? suggestCorrectedWagonNumber(wagonNumber) : null);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className={`badge ${ok ? 'badge-ok' : 'badge-err'}`}>
        {ok ? ru.checksum.ok : ru.checksum.error}
      </span>
      {!ok && suggested ? (
        <span className="text-xs text-[var(--muted)]">
          {ru.checksum.suggested}:{' '}
          <span className="wagon-no text-[var(--ink)]">{formatWagonNumber(suggested)}</span>
        </span>
      ) : null}
    </span>
  );
}
