import { number } from '../i18n/language.ts';
import { LanguagePicker } from './LanguagePicker.tsx';
import { useLanguage } from '../i18n/LanguageProvider.tsx';
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
  const { m, language } = useLanguage();
  const countLabel =
    filteredCount === totalVehicles
      ? m.liveCount(number(totalVehicles, language))
      : m.liveCount(`${number(filteredCount, language)} / ${number(totalVehicles, language)}`);

  const sourceSummary = bySource
    ? m.sourceCount(number(bySource.gps, language), number(bySource.estimated, language))
    : null;

  return (
    <header className="glass-panel header-badge">
      <div className="header-row">
        <div className="header-brand">
          <div className="live-dot-wrap" aria-hidden="true">
            {!hasError && <span className="live-dot-ping" />}
            <span className={`live-dot${hasError ? ' error' : ''}`} />
          </div>
          <h1 className="header-title">Oslo Live Transit</h1>
        </div>
        <LanguagePicker />
      </div>
      <div className="header-row">
        <div className="header-subtitle">
          <span>{lastUpdated ? m.updated(formatOsloTime(lastUpdated, language)) : m.connecting}</span>
          {sourceSummary && <span className="source-summary-tag" title={m.sources}> · {sourceSummary}</span>}
        </div>
        <div className="header-actions">
          <span className="vehicle-total-pill" aria-live="polite">
            {countLabel}
          </span>
          <button
            type="button"
            className={`icon-btn${isLoading ? ' spinning' : ''}`}
            onClick={onRefresh}
            title={m.refresh}
            aria-label={m.refresh}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
