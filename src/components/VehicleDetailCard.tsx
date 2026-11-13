import { useState } from 'react';
import { ChevronDown, ChevronUp, Crosshair, Flag, Maximize2, X } from 'lucide-react';
import type { LiveVehicle, VehicleJourneyDetails } from '../types/transit.ts';
import { ModeIcon } from './ModeIcon.tsx';
import {
  formatCompassBearing,
  formatDelay,
  formatOsloTime,
  formatSpeedKmh,
  getBadgeStyle,
  getVehicleColor,
  MODE_META,
} from './transitTheme.ts';

interface VehicleDetailCardProps {
  vehicle: LiveVehicle;
  journey: VehicleJourneyDetails | null;
  journeyLoading: boolean;
  journeyError?: string | null;
  isFollowing: boolean;
  onToggleFollow: () => void;
  onFitRoute?: () => void;
  onClose: () => void;
}

export function VehicleDetailCard({
  vehicle,
  journey,
  journeyLoading,
  journeyError,
  isFollowing,
  onToggleFollow,
  onFitRoute,
  onClose,
}: VehicleDetailCardProps) {
  const [isMinimized, setIsMinimized] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches,
  );
  const color = getVehicleColor(vehicle);
  const badgeStyle = getBadgeStyle(color);
  const modeLabel = MODE_META[vehicle.mode].label;
  const delay = formatDelay(vehicle.delaySeconds);
  const isGps = vehicle.positionSource === 'gps';
  const hasRouteGeometry = Boolean(
    journey &&
      (journey.pastCoordinates.length + journey.remainingCoordinates.length >= 2 ||
        journey.pastStops.length + journey.upcomingStops.length >= 2),
  );

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
          <span className="line-badge" style={badgeStyle}>
            {vehicle.lineCode}
          </span>
          <div className="detail-mini-text">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span className="detail-mini-dest">{vehicle.destination}</span>
              <span className={`source-badge ${vehicle.positionSource}`}>
                {isGps ? 'GPS' : 'EST'}
              </span>
            </div>
            <span className="detail-mini-meta">
              {modeLabel} · {vehicle.operator} ·{' '}
              {vehicle.nextStopName
                ? `Next: ${vehicle.nextStopName}`
                : journey?.endStationName
                  ? `To ${journey.endStationName}`
                  : formatSpeedKmh(vehicle.speed)}
              {delay.text !== '—' ? ` · ${delay.text}` : ''}
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
            <Crosshair size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setIsMinimized(false)}
            aria-label="Expand vehicle details"
            title="Expand details"
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close vehicle details"
            title="Close & clear route (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="glass-panel detail-card" aria-label="Selected vehicle details">
      <div className="detail-header">
        <div className="detail-line-row">
          <span className="line-badge" style={badgeStyle}>
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
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close vehicle details"
            title="Close & clear route (Esc)"
          >
            <X size={16} />
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
          <div className="detail-subline detail-stop-progress">
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

      <div className="detail-actions-row">
        <button
          type="button"
          className={`follow-btn${isFollowing ? ' active' : ''}`}
          onClick={onToggleFollow}
        >
          <Crosshair size={14} />
          {isFollowing ? 'Following' : 'Follow Vehicle'}
        </button>

        {hasRouteGeometry && onFitRoute && (
          <button
            type="button"
            className="fit-route-btn"
            onClick={onFitRoute}
            title="Zoom map to full journey"
          >
            <Maximize2 size={14} />
            Fit Route
          </button>
        )}
      </div>

      {journeyLoading && !journey ? (
        <div className="detail-subline">Loading route &amp; upcoming stops…</div>
      ) : journeyError && !journey ? (
        <div className="detail-subline">{journeyError}</div>
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
                  <div className="telemetry-terminus-name">
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
                  <span className="telemetry-meta">
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
                        className="stop-timeline-dot"
                        style={{
                          backgroundColor: idx === 0 ? color : '#475569',
                          borderColor: idx === 0 ? '#f8fafc' : 'transparent',
                        }}
                      />
                      <span
                        className="departure-dest"
                        style={{ fontWeight: idx === 0 ? 700 : 500 }}
                      >
                        {stop.name}
                      </span>
                      <span className="departure-time" style={{ fontSize: 12 }}>
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
