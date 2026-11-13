import { useEffect, useState } from 'react';

interface BootScreenProps {
  isVisible: boolean;
  hasVehicles: boolean;
  mapReady: boolean;
}

const BOOT_DOTS = [
  { label: 'Bus', color: '#EF4444', delayMs: 0 },
  { label: 'Tram', color: '#38BDF8', delayMs: 160 },
  { label: 'Metro', color: '#8B5CF6', delayMs: 320 },
  { label: 'Train', color: '#10B981', delayMs: 480 },
];

/** Full-screen loading overlay that fades out once the map and initial Entur live feed are ready. */
export function BootScreen({ isVisible, hasVehicles, mapReady }: BootScreenProps) {
  const [elapsedPhase, setElapsedPhase] = useState(false);

  useEffect(() => {
    if (!isVisible) return;
    const timer = window.setTimeout(() => setElapsedPhase(true), 2200);
    return () => window.clearTimeout(timer);
  }, [isVisible]);

  let statusText = 'Connecting to Entur live feeds…';
  if (!mapReady) {
    statusText = 'Initializing Oslo vector map…';
  } else if (hasVehicles) {
    statusText = 'Oslo live network ready';
  } else if (elapsedPhase) {
    statusText = 'Mapping Oslo buses, trams, metro & rail…';
  }

  return (
    <div
      className={`boot-screen${isVisible ? '' : ' hidden'}`}
      role="status"
      aria-live="polite"
      aria-hidden={!isVisible}
    >
      <div className="boot-radar" aria-hidden="true">
        <span className="boot-radar-ring" />
        <span className="boot-radar-ring delay" />
        <span className="boot-radar-core" />
      </div>

      <div className="boot-brand">
        <h1 className="boot-title">Oslo Live Transit</h1>
        <div className="boot-status">{statusText}</div>
      </div>

      <div className="boot-dots" aria-hidden="true">
        {BOOT_DOTS.map((dot) => (
          <span
            key={dot.label}
            className="boot-mode-dot"
            style={{
              backgroundColor: dot.color,
              boxShadow: `0 0 10px ${dot.color}88`,
              animationDelay: `${dot.delayMs}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
