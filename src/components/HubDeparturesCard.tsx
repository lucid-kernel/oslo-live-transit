import { useState } from 'react';
import { ChevronDown, ChevronUp, MapPin, X } from 'lucide-react';
import type { OsloHub, StopDeparture } from '../types/transit.ts';
import { formatOsloTime, getRouteColor, MODE_META } from './transitTheme.ts';

interface HubDeparturesCardProps {
  hub: OsloHub;
  departures: StopDeparture[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}

export function HubDeparturesCard({
  hub,
  departures,
  isLoading,
  error,
  onClose,
}: HubDeparturesCardProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const nextDep = departures[0];

  if (isMinimized) {
    return (
      <aside
        className="glass-panel detail-card minimized"
        aria-label={`${hub.name} summary`}
      >
        <div className="detail-mini-info">
          <span
            className="line-badge"
            style={{ backgroundColor: 'rgba(56, 189, 248, 0.18)', minWidth: 32, padding: '0 8px' }}
          >
            <MapPin size={15} color="#38BDF8" />
          </span>
          <div className="detail-mini-text">
            <span className="detail-mini-dest">{hub.name}</span>
            <span className="detail-mini-meta">
              {nextDep
                ? `Next: ${nextDep.lineCode} ${nextDep.destination} · ${formatOsloTime(nextDep.expectedTime).slice(0, 5)}`
                : isLoading
                  ? 'Loading live departures…'
                  : 'No upcoming departures'}
            </span>
          </div>
        </div>

        <div className="detail-header-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setIsMinimized(false)}
            aria-label="Expand stop departures"
            title="Expand departures"
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close hub departures"
            title="Close & clear stop routes"
          >
            <X size={15} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="glass-panel detail-card" aria-label={`${hub.name} live departures`}>
      <div className="detail-header">
        <div>
          <div className="mode-tag" style={{ marginBottom: 6 }}>
            <MapPin size={12} color="#38BDF8" />
            Live Stop Departures
          </div>
          <h2 className="detail-destination">{hub.name}</h2>
          <div className="detail-subline">Live departures via Entur JourneyPlanner</div>
        </div>
        <div className="detail-header-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setIsMinimized(true)}
            aria-label="Minimize stop departures"
            title="Minimize to keep routes visible"
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close hub departures"
            title="Close & clear stop routes"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {isLoading && departures.length === 0 ? (
        <div className="detail-subline">Loading live departures…</div>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : departures.length === 0 ? (
        <div className="detail-subline">No upcoming departures found.</div>
      ) : (
        <div className="departures-list">
          {departures.map((dep, idx) => {
            const color = getRouteColor(dep.mode, dep.lineCode);
            const delayMin = Math.round(dep.delaySeconds / 60);
            return (
              <div
                key={`${dep.lineCode}-${dep.aimedTime}-${idx}`}
                className="departure-row"
              >
                <span className="departure-badge" style={{ backgroundColor: color }}>
                  {dep.lineCode}
                </span>
                <div className="departure-info">
                  <span className="departure-dest">{dep.destination}</span>
                  <span className="departure-meta">
                    {MODE_META[dep.mode].label}
                    {dep.platform ? ` · Plat. ${dep.platform}` : ''}
                    {dep.realtime ? ' · Live' : ' · Sched.'}
                  </span>
                </div>
                <div className="departure-time">
                  <div>{formatOsloTime(dep.expectedTime).slice(0, 5)}</div>
                  {delayMin > 0 && (
                    <div style={{ fontSize: 10, color: '#fbbf24' }}>+{delayMin}m</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
