import { number } from '../i18n/language.ts';
import { useLanguage } from '../i18n/LanguageProvider.tsx';
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
  const { m, language } = useLanguage();
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
  const total = stats ? number(stats.total, language) : '–';
  const isScooter = selectedMode === 'scooter';
  const scooterColor = '#c4a2ff';
  const isAll = selectedMode === 'all';

  return (
    <nav className="hud-bottom-dock" aria-label={m.transitViews}>
      <div ref={bar} {...{ focusgroup: 'toolbar wrap' }} className="glass-panel view-dock" role="toolbar" aria-label={m.selectView}>
        <button
          type="button"
          aria-pressed={isAll}
          className={`view-dock-item${isAll ? ' active' : ''}`}
          title={m.allShortcut}
          onClick={() => onSelectMode('all')}
        >
          <span className="view-dock-icon">
            <Layers size={16} strokeWidth={2.1} color={isAll ? '#38bdf8' : 'currentColor'} />
          </span>
          <span className="view-dock-label">{m.all}</span>
          <span className="view-dock-count">{total}</span>
        </button>

        {MODE_ORDER.map((mode, idx) => {
          const meta = MODE_META[mode];
          const count = stats ? number(stats.byMode[mode], language) : '–';
          const isActive = selectedMode === mode;

          return (
            <button
              key={mode}
              type="button"
              aria-pressed={isActive}
              className={`view-dock-item${isActive ? ' active' : ''}`}
              title={m.modeShortcut(m[mode], String(idx + 2))}
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
              <span className="view-dock-label">{m[mode]}</span>
              <span className="view-dock-count">{count}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={isScooter}
          className={`view-dock-item${isScooter ? ' active' : ''}`}
          style={{ '--view-accent': scooterColor } as React.CSSProperties}
          title={m.scooterShortcut}
          onClick={() => onSelectMode(isScooter ? previousTransit : 'scooter')}
        >
          <span className="view-dock-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isScooter ? scooterColor : 'currentColor'}
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="5" cy="18" r="3" /><circle cx="19" cy="18" r="3" /><path d="M5 18h7l5-8m2 8L16 4h-4" />
            </svg>
            <span className="view-dock-dot" style={{ backgroundColor: scooterColor }} aria-hidden="true" />
          </span>
          <span className="view-dock-label">{m.scooter}</span>
        </button>
      </div>
    </nav>
  );
}
