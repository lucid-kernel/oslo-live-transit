import { Search, X } from 'lucide-react';
import type { NetworkData, RailCategory, TransitMode } from '../types/transit.ts';
import { MODE_META, RAIL_CATEGORY_LABELS } from './transitTheme.ts';

interface FilterBarProps {
  selectedMode: TransitMode | 'all';
  selectedRailCategory: RailCategory | 'all';
  onSelectRailCategory: (cat: RailCategory | 'all') => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  networkData: NetworkData | null;
  networkLoading: boolean;
  busStopsCount: number;
  busStopRoutesCount: number;
  isBusStopZoomReady: boolean;
}

const RAIL_CATEGORIES: RailCategory[] = ['local', 'regional', 'long_distance', 'airport'];

export function FilterBar({
  selectedMode,
  selectedRailCategory,
  onSelectRailCategory,
  searchQuery,
  onSearchChange,
  networkData,
  networkLoading,
  busStopsCount,
  busStopRoutesCount,
  isBusStopZoomReady,
}: FilterBarProps) {
  const isNetworkMode =
    selectedMode === 'metro' || selectedMode === 'train' || selectedMode === 'tram';

  return (
    <section className="glass-panel filter-panel" aria-label="Search and view options">
      <div className="search-box">
        <Search size={14} className="search-icon" />
        <input
          type="text"
          className="search-input"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search line, destination, or operator…"
          aria-label="Search by line number, destination, or operator"
        />
        {searchQuery && (
          <button
            type="button"
            className="search-clear"
            onClick={() => onSearchChange('')}
            aria-label="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {selectedMode === 'train' && (
        <div className="mode-pills" role="tablist" aria-label="Filter by rail category">
          <button
            type="button"
            role="tab"
            aria-selected={selectedRailCategory === 'all'}
            className={`mode-pill${selectedRailCategory === 'all' ? ' active' : ''}`}
            style={{ fontSize: 11, padding: '3px 9px' }}
            onClick={() => onSelectRailCategory('all')}
          >
            All Rail
          </button>
          {RAIL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={selectedRailCategory === cat}
              className={`mode-pill${selectedRailCategory === cat ? ' active' : ''}`}
              style={{ fontSize: 11, padding: '3px 9px' }}
              onClick={() =>
                onSelectRailCategory(selectedRailCategory === cat ? 'all' : cat)
              }
            >
              {RAIL_CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      )}

      {isNetworkMode && (
        <div
          style={{
            fontSize: 11,
            color: '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 2,
          }}
        >
          <span>
            {networkLoading
              ? `Loading ${MODE_META[selectedMode].label} network & stops…`
              : networkData
                ? `${selectedMode === 'train' ? 'Norway' : MODE_META[selectedMode].label} Network: ${networkData.routes.length} lines · ${networkData.stops.length} stops`
                : `${MODE_META[selectedMode].label} Network`}
          </span>
          {!networkLoading && networkData && (
            <span style={{ color: '#7dd3fc' }}>Click stop for departures</span>
          )}
        </div>
      )}

      {selectedMode === 'bus' && (
        <div
          style={{
            fontSize: 11,
            color: '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 2,
          }}
        >
          <span>
            {!isBusStopZoomReady
              ? 'Zoom in to see bus stops & stop routes'
              : busStopRoutesCount > 0
                ? `Showing ${busStopRoutesCount} routes through selected stop`
                : `${busStopsCount} bus stops in view`}
          </span>
          {isBusStopZoomReady && busStopsCount > 0 && busStopRoutesCount === 0 && (
            <span style={{ color: '#fca5a5' }}>Click stop to see routes</span>
          )}
        </div>
      )}
    </section>
  );
}
