import { useEffect, useRef } from 'react';
import { Layers } from 'lucide-react';
import type { MapView, TransitMode, VehicleStats } from '../types/transit.ts';
import { ModeIcon } from './ModeIcon.tsx';
import { MODE_META, MODE_ORDER } from './transitTheme.ts';

interface ViewDockProps {
  selectedMode: MapView;
  previousTransit?: TransitMode | 'all';
  onSelectMode: (mode: MapView) => void;
  stats: VehicleStats | null;
}

export function ViewDock({ selectedMode, onSelectMode, stats, previousTransit = 'all' }: ViewDockProps) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const toolbar = bar.current;
    if (!toolbar) return;
    const active = toolbar.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if ('focusGroup' in HTMLElement.prototype) return;
    const buttons = Array.from(toolbar.querySelectorAll('button'));
    const setTabStop = (item: EventTarget | null) => {
      for (const button of buttons) button.tabIndex = button === item ? 0 : -1;
    };
    setTabStop(active);
    const focus = (event: FocusEvent) => setTabStop(event.target);
    const navigate = (event: KeyboardEvent) => {
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const keys: Record<string, number> = {
        Home: 0, End: buttons.length - 1, ArrowRight: (index + 1) % buttons.length,
        ArrowLeft: (index - 1 + buttons.length) % buttons.length,
      };
      if (!(event.key in keys)) return;
      event.preventDefault();
      buttons[keys[event.key]].focus();
    };
    toolbar.addEventListener('focusin', focus);
    toolbar.addEventListener('keydown', navigate);
    return () => {
      toolbar.removeEventListener('focusin', focus);
      toolbar.removeEventListener('keydown', navigate);
    };
  }, [selectedMode]);
  const total = stats?.total ?? '–';
  const isAll = selectedMode === 'all';

  return (
    <nav className="hud-bottom-dock" aria-label="Transit views">
      <div ref={bar} {...{ focusgroup: 'toolbar wrap' }} className="glass-panel view-dock" role="toolbar" aria-label="Select map view">
        <button
          type="button"
          aria-pressed={isAll}
          className={`view-dock-item${isAll ? ' active' : ''}`}
          title="All transit modes (Shortcut: 1)"
          onClick={() => onSelectMode('all')}
        >
          <span className="view-dock-icon">
            <Layers size={16} strokeWidth={2.1} color={isAll ? '#38bdf8' : 'currentColor'} />
          </span>
          <span className="view-dock-label">Alle</span>
          <span className="view-dock-count">{total}</span>
        </button>

        {MODE_ORDER.map((mode, idx) => {
          const meta = MODE_META[mode];
          const count = stats?.byMode[mode] ?? '–';
          const isActive = selectedMode === mode;

          return (
            <button
              key={mode}
              type="button"
              aria-pressed={isActive}
              className={`view-dock-item${isActive ? ' active' : ''}`}
              title={`${meta.label} (${meta.englishLabel}) · Shortcut: ${idx + 2}`}
              style={
                isActive
                  ? ({ '--view-accent': meta.color } as React.CSSProperties)
                  : undefined
              }
              onClick={() => onSelectMode(isActive ? 'all' : mode)}
            >
              <span className="view-dock-icon">
                <ModeIcon
                  mode={mode}
                  size={16}
                  color={isActive ? meta.color : 'currentColor'}
                />
                <span
                  className="view-dock-dot"
                  style={{ backgroundColor: meta.color }}
                  aria-hidden="true"
                />
              </span>
              <span className="view-dock-label">{meta.label}</span>
              <span className="view-dock-count">{count}</span>
            </button>
          );
        })}
        <button type="button" aria-pressed={selectedMode === 'scooter'}
          className={`view-dock-item${selectedMode === 'scooter' ? ' active' : ''}`}
          title="Scooter (Shortcut: 7)" onClick={() => onSelectMode(selectedMode === 'scooter' ? previousTransit : 'scooter')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c4a2ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="5" cy="18" r="3" /><circle cx="19" cy="18" r="3" /><path d="M5 18h7l5-8m2 8L16 4h-4" />
          </svg>
          <span className="view-dock-label">Scooter</span>
        </button>
      </div>
    </nav>
  );
}
