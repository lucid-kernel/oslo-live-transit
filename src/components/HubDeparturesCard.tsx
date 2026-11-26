import { number } from '../i18n/language.ts';
import { useLanguage } from '../i18n/LanguageProvider.tsx';
import { useEffect, useState } from 'react';
import type { LocalLayers } from '../hooks/useLocalLayers.ts';
import { StopLayerDetails } from './StopLayerDetails.tsx';
import { ChevronDown, ChevronUp, MapPin, RotateCw, X } from 'lucide-react';
import type { OsloHub, StopDeparture } from '../types/transit.ts';
import {
  formatDepartureCountdown,
  formatOsloTime,
  getBadgeStyle,
  getRouteColor,
} from './transitTheme.ts';

interface HubDeparturesCardProps {
  layers: LocalLayers;
  hub: OsloHub;
  departures: StopDeparture[];
  isLoading: boolean;
  error: boolean;
  onRetry?: () => void;
  onClose: () => void;
}

export function HubDeparturesCard({
  layers,
  hub,
  departures,
  isLoading,
  error,
  onRetry,
  onClose,
}: HubDeparturesCardProps) {
  const { m, language } = useLanguage();
  const [isMinimized, setIsMinimized] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches,
  );
  const [nowMs, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const upcoming = departures.filter((dep) => Date.parse(dep.expectedTime) >= nowMs);
  const nextDep = upcoming[0];

  if (isMinimized) {
    const nextCountdown = nextDep ? formatDepartureCountdown(nextDep.expectedTime, language) : null;
    return (
      <aside
        className="glass-panel detail-card minimized"
        aria-label={m.hubSummary(hub.name)}
      >
        <button
          type="button"
          className="detail-mini-info detail-mini-trigger"
          onClick={() => setIsMinimized(false)}
          aria-label={m.expandStop}
        >
          <span
            className="line-badge"
            style={{ backgroundColor: 'rgba(56, 189, 248, 0.18)', minWidth: 32, padding: '0 8px' }}
          >
            <MapPin size={15} color="#38BDF8" />
          </span>
          <div className="detail-mini-text">
            <span className="detail-mini-dest">{hub.name}</span>
            <span className="detail-mini-meta">
              {layers.stopNotices.length > 0 && <strong className="mini-notice">{m.noticeCount(layers.stopNotices.length)} · </strong>}
              {nextDep
                ? m.next(`${nextDep.lineCode} ${nextDep.destination || m.unknownDestination} · ${nextCountdown ?? formatOsloTime(nextDep.expectedTime, language, 'short')}`)
                : isLoading
                  ? m.loadingDepartures
                  : m.noDepartures}
            </span>
          </div>
        </button>

        <div className="detail-header-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setIsMinimized(false)}
            aria-label={m.expandStop}
            title={m.expandDepartures}
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={m.closeStop}
            title={m.clearStop}
          >
            <X size={16} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="glass-panel detail-card" aria-label={m.hubDepartures(hub.name)}>
      <div className="detail-header">
        <div>
          <div className="mode-tag" style={{ marginBottom: 6 }}>
            <MapPin size={12} color="#38BDF8" />
            {m.liveDepartures}
          </div>
          <h2 className="detail-destination">{hub.name}</h2>
          <div className="detail-subline">{m.viaEntur}</div>
        </div>
        <div className="detail-header-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setIsMinimized(true)}
            aria-label={m.minimizeStop}
            title={m.keepRoutes}
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={m.closeStop}
            title={m.clearStop}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <StopLayerDetails layers={layers} />

      {isLoading && upcoming.length === 0 ? (
        <div className="detail-subline">{m.loadingDepartures}</div>
      ) : error ? (
        <div className="error-banner" role="alert">
          <span style={{ flex: 1 }}>{m.departuresFailed}</span>
          {onRetry && (
            <button type="button" className="retry-btn" onClick={onRetry}>
              <RotateCw size={12} />
              {m.retry}
            </button>
          )}
        </div>
      ) : upcoming.length === 0 ? (
        <div className="detail-subline">{m.noDeparturesFound}</div>
      ) : (
        <div className="departures-list">
          {upcoming.map((dep, idx) => {
            const color = getRouteColor(dep);
            const badgeStyle = getBadgeStyle(color);
            const delayMin = Math.round(dep.delaySeconds / 60);
            return (
              <div
                key={`${dep.lineCode}-${dep.aimedTime}-${idx}`}
                className="departure-row"
              >
                <span className="departure-badge" style={badgeStyle}>
                  {dep.lineCode}
                </span>
                <div className="departure-info">
                  <span className="departure-dest">{dep.destination || m.unknownDestination}</span>
                  <span className="departure-meta">
                    {m[dep.mode]}
                    {dep.platform ? ` · ${m.platform(dep.platform)}` : ''}
                     · {dep.realtime ? m.live : m.scheduled}
                  </span>
                </div>
                <div className="departure-time">
                  <div>
                    {formatDepartureCountdown(dep.expectedTime, language) ??
                      formatOsloTime(dep.expectedTime, language, 'short')}
                  </div>
                  <div className={`departure-subtime${delayMin > 0 ? ' delayed' : ''}`}>
                    {formatOsloTime(dep.expectedTime, language, 'short')}
                    {delayMin > 0 ? ` · +${m.minutes(number(delayMin, language))}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
