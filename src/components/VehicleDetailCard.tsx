import { useState } from 'react';
import { ChevronDown, ChevronUp, Crosshair, Flag, X } from 'lucide-react';
import type { LiveVehicle, VehicleJourneyDetails } from '../types/transit.ts';
import { ModeIcon } from './ModeIcon.tsx';
import {
  formatCompassBearing,
  formatDelay,
  formatOsloTime,
  formatSpeedKmh,
  getVehicleColor,
  MODE_META,
} from './transitTheme.ts';

interface VehicleDetailCardProps {
  vehicle: LiveVehicle;
  journey: VehicleJourneyDetails | null;
  journeyLoading: boolean;
  isFollowing: boolean;
  onToggleFollow: () => void;
  onClose: () => void;
}

export function VehicleDetailCard({
  vehicle,
  journey,
  journeyLoading,
  isFollowing,
  onToggleFollow,
  onClose,
}: VehicleDetailCardProps) {
  const [isMinimized, setIsMinimized] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  );
  const color = getVehicleColor(vehicle);
  const modeLabel = MODE_META[vehicle.mode].label;
  const delay = formatDelay(vehicle.delaySeconds);
  const isGps = vehicle.positionSource === 'gps';

  if (isMinimized) {
    return (
      <aside
        className="glass-panel detail-card minimized"
        aria-label="Selected vehicle summary"
      >
        <button
          type="button"
          className="detail-mini-info detail-mini-trigger"
          onClick={() => setIsMinimized(false)}
          aria-label="Expand vehicle details"
        >
          <span className="line-badge" style={{ backgroundColor: color }}>
            {vehicle.lineCode}
          </span>
          <div className="detail-mini-text">
            <span className="detail-mini-dest">{vehicle.destination}</span>
            <span className="detail-mini-meta">
              {vehicle.nextStopName
                ? `Next: ${vehicle.nextStopName}`
                : journey?.endStationName
                  ? `To ${journey.endStationName}`
                  : modeLabel}
            </span>
          </div>
        </button>

        <div className="detail-header-actions">
          <button
            type="button"
            className={`icon-btn${isFollowing ? ' active' : ''}`}
            onClick={onToggleFollow}
            aria-label={isFollowing ? 'Stop following vehicle' : 'Follow vehicle'}
            title={isFollowing ? 'Following vehicle' : 'Follow vehicle'}
          >
            <Crosshair size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setIsMinimized(false)}
            aria-label="Expand vehicle details"
            title="Expand details"
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close vehicle details"
            title="Close & clear route"
          >
            <X size={15} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="glass-panel detail-card" aria-label="Selected vehicle details">
      <div className="detail-header">
        <div className="detail-line-row">
          <span className="line-badge" style={{ backgroundColor: color }}>
            {vehicle.lineCode}
          </span>
          <span className="mode-tag">
            <ModeIcon mode={vehicle.mode} size={12} color={color} />
            {modeLabel}
          </span>
          <span
            className={`source-badge ${vehicle.positionSource}`}
            title={
              isGps
                ? 'Direct live GPS telemetry from vehicle'
                : 'Live-estimated position along route using Entur realtime stop times'
            }
          >
            {isGps ? 'Live GPS' : 'Estimated'}
          </span>
        </div>

        <div className="detail-header-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setIsMinimized(true)}
            aria-label="Minimize vehicle details"
            title="Minimize to keep route visible"
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close vehicle details"
            title="Close & clear route"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div>
        <h2 className="detail-destination">{vehicle.destination}</h2>
        <div className="detail-subline">
          {vehicle.operator}
          {vehicle.lineName && vehicle.lineName !== vehicle.lineCode
            ? ` · ${vehicle.lineName}`
            : ''}
        </div>
        {vehicle.origin && (
          <div className="detail-subline">From {vehicle.origin}</div>
        )}
        {(vehicle.currentStopName || vehicle.nextStopName) && (
          <div className="detail-subline" style={{ color: '#bae6fd', marginTop: 4 }}>
            {vehicle.currentStopName && vehicle.nextStopName
              ? `${vehicle.currentStopName} → ${vehicle.nextStopName}`
              : vehicle.nextStopName
                ? `Next stop: ${vehicle.nextStopName}`
                : `At ${vehicle.currentStopName}`}
          </div>
        )}
      </div>

      <div className="telemetry-grid">
        <div className="telemetry-item">
          <span className="telemetry-label">Speed</span>
          <span className="telemetry-value">{formatSpeedKmh(vehicle.speed)}</span>
        </div>

        <div className="telemetry-item">
          <span className="telemetry-label">Schedule</span>
          <span className={`telemetry-value ${delay.tone === 'neutral' ? '' : delay.tone}`}>
            {delay.text}
          </span>
        </div>

        <div className="telemetry-item">
          <span className="telemetry-label">Heading</span>
          <span className="telemetry-value">{formatCompassBearing(vehicle.bearing)}</span>
        </div>

        <div className="telemetry-item">
          <span className="telemetry-label">{isGps ? 'GPS Signal' : 'Schedule Sync'}</span>
          <span className="telemetry-value">{formatOsloTime(vehicle.lastUpdated)}</span>
        </div>
      </div>

      <button
        type="button"
        className={`follow-btn${isFollowing ? ' active' : ''}`}
        onClick={onToggleFollow}
      >
        <Crosshair size={14} />
        {isFollowing ? 'Following Vehicle' : 'Follow Vehicle'}
      </button>

      {journeyLoading && !journey ? (
        <div className="detail-subline">Loading route &amp; upcoming stops…</div>
      ) : journey ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {journey.endStationName && (
            <div
              className="telemetry-item"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <Flag size={13} color={color} style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div className="telemetry-label">Terminus</div>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: '#f8fafc',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {journey.endStationName}
                  </div>
                </div>
              </div>
              {journey.endStationEta && (
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="telemetry-label">ETA</div>
                  <div className="telemetry-value">
                    {formatOsloTime(journey.endStationEta).slice(0, 5)}
                  </div>
                </div>
              )}
            </div>
          )}

          {journey.upcomingStops.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span className="telemetry-label">
                  Upcoming Stops ({journey.upcomingStops.length})
                </span>
                {journey.pastStops.length > 0 && (
                  <span style={{ fontSize: 10.5, color: '#64748b' }}>
                    {journey.pastStops.length} passed
                  </span>
                )}
              </div>

              <div className="departures-list" style={{ maxHeight: 190 }}>
                {journey.upcomingStops.map((stop, idx) => {
                  const eta = stop.expectedTime ?? stop.aimedTime;
                  return (
                    <div
                      key={`${stop.stopId}-${idx}`}
                      className="departure-row"
                      style={{ gridTemplateColumns: '10px 1fr auto', padding: '6px 9px' }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          backgroundColor: idx === 0 ? color : '#475569',
                          boxShadow: idx === 0 ? `0 0 8px ${color}` : 'none',
                        }}
                      />
                      <span
                        className="departure-dest"
                        style={{ fontWeight: idx === 0 ? 700 : 500 }}
                      >
                        {stop.name}
                      </span>
                      <span className="departure-time" style={{ fontSize: 11.5 }}>
                        {eta ? formatOsloTime(eta).slice(0, 5) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </aside>
  );
}
