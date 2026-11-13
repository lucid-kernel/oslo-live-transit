import { RefreshCw } from 'lucide-react';
import type { PositionSource } from '../types/transit.ts';
import { formatOsloTime } from './transitTheme.ts';

interface HeaderBadgeProps {
  totalVehicles: number;
  filteredCount: number;
  bySource: Record<PositionSource, number> | null;
  lastUpdated: string | null;
  isLoading: boolean;
  hasError: boolean;
  onRefresh: () => void;
}

export function HeaderBadge({
  totalVehicles,
  filteredCount,
  bySource,
  lastUpdated,
  isLoading,
  hasError,
  onRefresh,
}: HeaderBadgeProps) {
  const countLabel =
    filteredCount === totalVehicles
      ? `${totalVehicles} live`
      : `${filteredCount} / ${totalVehicles} live`;

  const sourceSummary = bySource
    ? `${bySource.gps} GPS · ${bySource.estimated} Est.`
    : null;

  return (
    <header className="glass-panel header-badge">
      <div className="header-brand">
        <div className="live-dot-wrap" aria-hidden="true">
          {!hasError && <span className="live-dot-ping" />}
          <span className={`live-dot${hasError ? ' error' : ''}`} />
        </div>
        <div className="header-title-group">
          <h1 className="header-title">Oslo Live Transit</h1>
          <div className="header-subtitle">
            <span>
              {lastUpdated
                ? `Updated ${formatOsloTime(lastUpdated)}`
                : 'Connecting to Entur…'}
            </span>
            {sourceSummary && (
              <span
                className="source-summary-tag"
                title="Direct SIRI-VM GPS vs. Entur route-interpolated vehicles"
              >
                · {sourceSummary}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="header-actions">
        <span className="vehicle-total-pill" aria-live="polite">
          {countLabel}
        </span>
        <button
          type="button"
          className={`icon-btn${isLoading ? ' spinning' : ''}`}
          onClick={onRefresh}
          title="Refresh live vehicles"
          aria-label="Refresh live vehicles"
        >
          <RefreshCw size={15} />
        </button>
      </div>
    </header>
  );
}
