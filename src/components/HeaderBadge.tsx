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
    ? ` · ${bySource.gps} GPS · ${bySource.estimated} Est.`
    : '';

  return (
    <header className="glass-panel header-badge">
      <div className="header-brand">
        <div className="live-dot-wrap" aria-hidden="true">
          {!hasError && <span className="live-dot-ping" />}
          <span className={`live-dot${hasError ? ' error' : ''}`} />
        </div>
        <div className="header-title-group">
          <div className="header-title">Oslo Live Transit</div>
          <div className="header-subtitle">
            {lastUpdated
              ? `Updated ${formatOsloTime(lastUpdated)}${sourceSummary}`
              : 'Connecting to Entur…'}
          </div>
        </div>
      </div>

      <div className="header-actions">
        <span className="vehicle-total-pill">{countLabel}</span>
        <button
          type="button"
          className={`icon-btn${isLoading ? ' spinning' : ''}`}
          onClick={onRefresh}
          title="Refresh live vehicles"
          aria-label="Refresh live vehicles"
        >
          <RefreshCw size={14} />
        </button>
      </div>
    </header>
  );
}
