import { number } from '../i18n/language.ts';
import { useLanguage } from '../i18n/LanguageProvider.tsx';
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
} from './transitTheme.ts';

interface VehicleDetailCardProps {
  vehicle: LiveVehicle;
  journey: VehicleJourneyDetails | null;
  journeyLoading: boolean;
  journeyError?: boolean;
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
  const { m, language } = useLanguage();
  const [isMinimized, setIsMinimized] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches,
  );
  const color = getVehicleColor(vehicle);
  const badgeStyle = getBadgeStyle(color);
  const modeLabel = m[vehicle.mode];
  const delay = formatDelay(vehicle.delaySeconds, language);
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
        aria-label={m.vehicleSummary}
      >
        <button
          type="button"
          className="detail-mini-info detail-mini-trigger"
          onClick={() => setIsMinimized(false)}
          aria-label={m.expandVehicle}
        >
          <span className="line-badge" style={badgeStyle}>
            {vehicle.lineCode}
          </span>
          <div className="detail-mini-text">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span className="detail-mini-dest">{vehicle.destination || m.inService}</span>
              <span className={`source-badge ${vehicle.positionSource}`}>
                {isGps ? 'GPS' : m.est}
              </span>
            </div>
            <span className="detail-mini-meta">
              {modeLabel} · {vehicle.operator || m.unknownOperator} ·{' '}
              {vehicle.nextStopName
                ? m.next(vehicle.nextStopName)
                : journey?.endStationName
                  ? m.to(journey.endStationName)
                  : formatSpeedKmh(vehicle.speed, language)}
              {delay.text !== '—' ? ` · ${delay.text}` : ''}
            </span>
          </div>
        </button>

        <div className="detail-header-actions">
          <button
            type="button"
            className={`icon-btn${isFollowing ? ' active' : ''}`}
            onClick={onToggleFollow}
            aria-label={isFollowing ? m.stopFollow : m.follow}
            title={isFollowing ? m.followingVehicle : m.follow}
          >
            <Crosshair size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setIsMinimized(false)}
            aria-label={m.expandVehicle}
            title={m.expandDetails}
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={m.closeVehicle}
            title={m.closeRoute}
          >
            <X size={16} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="glass-panel detail-card" aria-label={m.vehicleDetails}>
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
                ? m.gpsSource
                : m.estimatedSource
            }
          >
            {isGps ? m.liveGps : m.estimated}
          </span>
        </div>

        <div className="detail-header-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setIsMinimized(true)}
            aria-label={m.minimizeVehicle}
            title={m.keepRoute}
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label={m.closeVehicle}
            title={m.closeRoute}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div>
        <h2 className="detail-destination">{vehicle.destination || m.inService}</h2>
        <div className="detail-subline">
          {vehicle.operator || m.unknownOperator}
          {vehicle.lineName && vehicle.lineName !== vehicle.lineCode
            ? ` · ${vehicle.lineName}`
            : ''}
        </div>
        {vehicle.origin && (
          <div className="detail-subline">{m.from(vehicle.origin)}</div>
        )}
        {(vehicle.currentStopName || vehicle.nextStopName) && (
          <div className="detail-subline detail-stop-progress">
            {vehicle.currentStopName && vehicle.nextStopName
              ? `${vehicle.currentStopName} → ${vehicle.nextStopName}`
              : vehicle.nextStopName
                ? m.nextStop(vehicle.nextStopName)
                : m.at(vehicle.currentStopName ?? '')}
          </div>
        )}
      </div>

      <div className="telemetry-grid">
        <div className="telemetry-item">
          <span className="telemetry-label">{m.speed}</span>
          <span className="telemetry-value">{formatSpeedKmh(vehicle.speed, language)}</span>
        </div>

        <div className="telemetry-item">
          <span className="telemetry-label">{m.schedule}</span>
          <span className={`telemetry-value ${delay.tone === 'neutral' ? '' : delay.tone}`}>
            {delay.text}
          </span>
        </div>

        <div className="telemetry-item">
          <span className="telemetry-label">{m.heading}</span>
          <span className="telemetry-value">{formatCompassBearing(vehicle.bearing, language)}</span>
        </div>

        <div className="telemetry-item">
          <span className="telemetry-label">{isGps ? m.gpsSignal : m.scheduleSync}</span>
          <span className="telemetry-value">{formatOsloTime(vehicle.lastUpdated, language)}</span>
        </div>
      </div>

      <div className="detail-actions-row">
        <button
          type="button"
          className={`follow-btn${isFollowing ? ' active' : ''}`}
          onClick={onToggleFollow}
        >
          <Crosshair size={14} />
          {isFollowing ? m.following : m.follow}
        </button>

        {hasRouteGeometry && onFitRoute && (
          <button
            type="button"
            className="fit-route-btn"
            onClick={onFitRoute}
            title={m.fitTitle}
          >
            <Maximize2 size={14} />
            {m.fit}
          </button>
        )}
      </div>

      {journeyLoading && !journey ? (
        <div className="detail-subline">{m.loadingJourney}</div>
      ) : journeyError && !journey ? (
        <div className="detail-subline">{m.journeyFailed}</div>
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
                  <div className="telemetry-label">{m.terminus}</div>
                  <div className="telemetry-terminus-name">
                    {journey.endStationName}
                  </div>
                </div>
              </div>
              {journey.endStationEta && (
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="telemetry-label">{m.eta}</div>
                  <div className="telemetry-value">
                    {formatOsloTime(journey.endStationEta, language, 'short')}
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
                  {m.upcoming(number(journey.upcomingStops.length, language))}
                </span>
                {journey.pastStops.length > 0 && (
                  <span className="telemetry-meta">
                    {m.passed(number(journey.pastStops.length, language))}
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
                        {eta ? formatOsloTime(eta, language, 'short') : '—'}
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
