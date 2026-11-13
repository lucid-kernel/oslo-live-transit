import { MapPin, X } from 'lucide-react';
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
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label="Close hub departures"
        >
          <X size={15} />
        </button>
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
