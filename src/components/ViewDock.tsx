import { Layers } from 'lucide-react';
import type { TransitMode, VehicleStats } from '../types/transit.ts';
import { ModeIcon } from './ModeIcon.tsx';
import { MODE_META, MODE_ORDER } from './transitTheme.ts';

interface ViewDockProps {
  selectedMode: TransitMode | 'all';
  onSelectMode: (mode: TransitMode | 'all') => void;
  stats: VehicleStats | null;
}

export function ViewDock({ selectedMode, onSelectMode, stats }: ViewDockProps) {
  const total = stats?.total ?? 0;
  const isAll = selectedMode === 'all';

  return (
    <nav className="hud-bottom-dock" aria-label="Transit views">
      <div className="glass-panel view-dock" role="toolbar" aria-label="Select map view">
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
          const count = stats?.byMode[mode] ?? 0;
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
      </div>
    </nav>
  );
}
