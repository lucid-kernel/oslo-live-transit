import { useEffect, useState } from 'react';
import { MODE_META, MODE_ORDER } from './transitTheme.ts';

interface BootScreenProps {
  isVisible: boolean;
  hasVehicles: boolean;
  mapReady: boolean;
}

const BOOT_DOTS = MODE_ORDER.map((mode, idx) => ({
  label: MODE_META[mode].label,
  color: MODE_META[mode].color,
  delayMs: idx * 140,
}));

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
    statusText = 'Mapping Oslo Buss, Trikk, T-bane, Tog & Båt…';
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
        <div className="boot-title">Oslo Live Transit</div>
        <div className="boot-status">{statusText}</div>
      </div>

      <div className="boot-dots" aria-hidden="true">
        {BOOT_DOTS.map((dot) => (
          <span
            key={dot.label}
            className="boot-mode-dot"
            style={{
              backgroundColor: dot.color,
              animationDelay: `${dot.delayMs}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
