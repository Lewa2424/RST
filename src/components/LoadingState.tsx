import React from 'react';

export function Spinner({ large = false, className = '' }: { large?: boolean; className?: string }) {
  return <span className={`spinner ${large ? 'spinner-lg' : ''} ${className}`.trim()} aria-hidden="true" />;
}

export function WaitingDots() {
  return (
    <span className="loading-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function LoadingState({
  label,
  skeletons = 0,
}: {
  label: string;
  skeletons?: number;
}) {
  return (
    <div className="py-8 space-y-4" role="status" aria-live="polite" aria-busy="true">
      <div className="flex flex-col items-center justify-center gap-3 text-[var(--muted)]">
        <Spinner large />
        <p className="flex items-center gap-2 font-medium">
          {label}
          <WaitingDots />
        </p>
      </div>
      {skeletons > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: skeletons }, (_, i) => (
            <div key={i} className="card p-5 space-y-3">
              <div className="skeleton h-6 w-2/5" />
              <div className="skeleton h-16 w-full" />
              <div className="skeleton h-10 w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LoadingOverlay({ label }: { label: string }) {
  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <Spinner large />
        <p className="flex items-center gap-2 font-semibold text-[var(--ink)]">
          {label}
          <WaitingDots />
        </p>
      </div>
    </div>
  );
}
