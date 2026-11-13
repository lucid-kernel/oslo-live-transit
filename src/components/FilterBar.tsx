import { useEffect, useMemo, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';
import { ListFilter, MapPin, Search, X } from 'lucide-react';
import type { LiveVehicle, NetworkData, OsloHub, RailCategory, TransitMode } from '../types/transit.ts';
import { ModeIcon } from './ModeIcon.tsx';
import {
  formatDelay,
  getBadgeStyle,
  getVehicleColor,
  MODE_META,
  RAIL_CATEGORY_LABELS,
} from './transitTheme.ts';

interface FilterBarProps {
  selectedMode: TransitMode | 'all';
  selectedRailCategory: RailCategory | 'all';
  onSelectRailCategory: (cat: RailCategory | 'all') => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  filteredVehicles: LiveVehicle[];
  allMatchingCount: number;
  hubs: OsloHub[];
  onSelectVehicle: (vehicle: LiveVehicle) => void;
  onSelectHub: (hub: OsloHub) => void;
  onResetMode: () => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  networkData: NetworkData | null;
  networkLoading: boolean;
  busStopsCount: number;
  busStopRoutesCount: number;
  isBusStopZoomReady: boolean;
}

const RAIL_CATEGORIES: RailCategory[] = ['local', 'regional', 'long_distance', 'airport'];
const QUICK_SEARCH_CHIPS = ['31', '19', 'L1', 'Oslo S'];

type SearchResultEntry =
  | { kind: 'hub'; key: string; hub: OsloHub }
  | { kind: 'vehicle'; key: string; vehicle: LiveVehicle };

export function FilterBar({
  selectedMode,
  selectedRailCategory,
  onSelectRailCategory,
  searchQuery,
  onSearchChange,
  filteredVehicles,
  allMatchingCount,
  hubs,
  onSelectVehicle,
  onSelectHub,
  onResetMode,
  searchInputRef,
  networkData,
  networkLoading,
  busStopsCount,
  busStopRoutesCount,
  isBusStopZoomReady,
}: FilterBarProps) {
  const [isListToggled, setIsListToggled] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const q = searchQuery.trim().toLowerCase();
  const isNetworkMode =
    selectedMode === 'metro' || selectedMode === 'train' || selectedMode === 'tram';

  const matchingHubs = useMemo(() => {
    if (!q) return hubs.slice(0, 5);
    return hubs.filter((h) => h.name.toLowerCase().includes(q)).slice(0, 3);
  }, [hubs, q]);

  const sortedVehicles = useMemo(() => {
    const limit = q ? 6 : 8;
    return [...filteredVehicles]
      .sort((a, b) =>
        a.lineCode.localeCompare(b.lineCode, 'nb', { numeric: true }) ||
        a.destination.localeCompare(b.destination, 'nb'),
      )
      .slice(0, limit);
  }, [filteredVehicles, q]);

  const resultEntries = useMemo<SearchResultEntry[]>(() => {
    const items: SearchResultEntry[] = [];
    for (const hub of matchingHubs) {
      items.push({ kind: 'hub', key: `hub-${hub.id}`, hub });
    }
    for (const vehicle of sortedVehicles) {
      items.push({ kind: 'vehicle', key: `veh-${vehicle.id}`, vehicle });
    }
    return items;
  }, [matchingHubs, sortedVehicles]);

  const showEmptyState =
    q.length > 0 && filteredVehicles.length === 0 && matchingHubs.length === 0;

  const isDropdownOpen =
    !showEmptyState &&
    resultEntries.length > 0 &&
    (isListToggled || (isInputFocused && q.length > 0));

  useEffect(() => {
    if (!isDropdownOpen || resultEntries.length === 0) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex(q.length > 0 ? 0 : -1);
  }, [q, isDropdownOpen, resultEntries.length]);

  const selectEntry = (entry: SearchResultEntry) => {
    if (entry.kind === 'hub') {
      onSelectHub(entry.hub);
    } else {
      onSelectVehicle(entry.vehicle);
    }
    setIsListToggled(false);
    setIsInputFocused(false);
    setActiveIndex(-1);
  };

  const handleContainerBlur = (e: FocusEvent<HTMLElement>) => {
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) {
      return;
    }
    setIsInputFocused(false);
    setIsListToggled(false);
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (resultEntries.length === 0) return;
      e.preventDefault();
      if (!isDropdownOpen) setIsListToggled(true);
      setActiveIndex((prev) => (prev + 1) % resultEntries.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (resultEntries.length === 0) return;
      e.preventDefault();
      if (!isDropdownOpen) setIsListToggled(true);
      setActiveIndex((prev) => (prev <= 0 ? resultEntries.length - 1 : prev - 1));
      return;
    }
    if (e.key === 'Enter' && isDropdownOpen && resultEntries.length > 0) {
      e.preventDefault();
      const target = resultEntries[activeIndex >= 0 ? activeIndex : 0];
      if (target) selectEntry(target);
      return;
    }
    if (e.key === 'Escape' && (isDropdownOpen || isListToggled)) {
      e.stopPropagation();
      setIsListToggled(false);
      setIsInputFocused(false);
      searchInputRef?.current?.blur();
    }
  };

  const activeEntry =
    activeIndex >= 0 && activeIndex < resultEntries.length ? resultEntries[activeIndex] : null;

  return (
    <section
      className="glass-panel filter-panel"
      aria-label="Search and view options"
      onBlur={handleContainerBlur}
    >
      <div className="search-row">
        <div className="search-box">
          <Search size={15} className="search-icon" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            value={searchQuery}
            onFocus={() => setIsInputFocused(true)}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search line, stop, or destination… ( / )"
            aria-label="Search by line number, stop, destination, or operator"
            aria-expanded={isDropdownOpen}
            aria-controls="transit-search-results"
            aria-activedescendant={activeEntry ? `search-opt-${activeEntry.key}` : undefined}
            role="combobox"
            aria-autocomplete="list"
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear"
              onClick={() => {
                onSearchChange('');
                searchInputRef?.current?.focus();
              }}
              aria-label="Clear search"
              title="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <button
          type="button"
          className={`icon-btn search-list-toggle${isListToggled ? ' active' : ''}`}
          onClick={() => setIsListToggled((prev) => !prev)}
          aria-expanded={isDropdownOpen}
          aria-label="Browse live vehicles and hubs list"
          title="Browse live vehicles & hubs"
        >
          <ListFilter size={15} />
        </button>
      </div>

      {isDropdownOpen && (
        <div
          id="transit-search-results"
          className="search-results-panel"
          role="listbox"
          aria-label="Matching hubs and live vehicles"
        >
          {resultEntries.map((entry, idx) => {
            const isActive = idx === activeIndex;
            if (entry.kind === 'hub') {
              return (
                <button
                  key={entry.key}
                  id={`search-opt-${entry.key}`}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`search-result-item${isActive ? ' active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectEntry(entry)}
                >
                  <span className="search-result-hub-badge" aria-hidden="true">
                    <MapPin size={13} />
                  </span>
                  <span className="search-result-main">
                    <span className="search-result-title">{entry.hub.name}</span>
                    <span className="search-result-meta">Hub · Live departures</span>
                  </span>
                </button>
              );
            }

            const v = entry.vehicle;
            const color = getVehicleColor(v);
            const badgeStyle = getBadgeStyle(color);
            const delay = formatDelay(v.delaySeconds);

            return (
              <button
                key={entry.key}
                id={`search-opt-${entry.key}`}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`search-result-item${isActive ? ' active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectEntry(entry)}
              >
                <span className="search-result-badge" style={badgeStyle}>
                  {v.lineCode}
                </span>
                <span className="search-result-main">
                  <span className="search-result-title">{v.destination}</span>
                  <span className="search-result-meta">
                    <ModeIcon mode={v.mode} size={11} color={color} />
                    <span>{MODE_META[v.mode].label}</span>
                    <span>· {v.operator}</span>
                    {v.nextStopName ? ` · Next: ${v.nextStopName}` : ''}
                  </span>
                </span>
                {delay.text !== '—' && (
                  <span className={`search-result-delay ${delay.tone}`}>{delay.text}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {showEmptyState && (
        <div className="empty-state-card" role="status" aria-live="polite">
          <div className="empty-state-title">
            {allMatchingCount > 0 && selectedMode !== 'all'
              ? `No '${searchQuery.trim()}' vehicles in ${MODE_META[selectedMode].label} (${MODE_META[selectedMode].englishLabel})`
              : `No active vehicles match '${searchQuery.trim()}'`}
          </div>
          <div className="empty-state-actions">
            {allMatchingCount > 0 && selectedMode !== 'all' && (
              <button type="button" className="empty-action-primary" onClick={onResetMode}>
                Show {allMatchingCount} across all modes
              </button>
            )}
            <button
              type="button"
              className="empty-action-secondary"
              onClick={() => onSearchChange('')}
            >
              Clear search
            </button>
          </div>
          {allMatchingCount === 0 && (
            <div className="empty-quick-chips">
              {QUICK_SEARCH_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="empty-chip-btn"
                  onClick={() => onSearchChange(chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedMode === 'train' && (
        <div className="mode-pills" role="group" aria-label="Filter by rail category">
          <button
            type="button"
            aria-pressed={selectedRailCategory === 'all'}
            className={`mode-pill${selectedRailCategory === 'all' ? ' active' : ''}`}
            onClick={() => onSelectRailCategory('all')}
          >
            All Rail
          </button>
          {RAIL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={selectedRailCategory === cat}
              className={`mode-pill${selectedRailCategory === cat ? ' active' : ''}`}
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
        <div className="filter-status-bar">
          <span>
            {networkLoading
              ? `Loading ${MODE_META[selectedMode].label} network & stops…`
              : networkData
                ? `${selectedMode === 'train' ? 'Norway' : MODE_META[selectedMode].label} Network: ${networkData.routes.length} lines · ${networkData.stops.length} stops`
                : `${MODE_META[selectedMode].label} Network`}
          </span>
          {!networkLoading && networkData && (
            <span className="filter-status-hint">Select stop for departures</span>
          )}
        </div>
      )}

      {selectedMode === 'bus' && (
        <div className="filter-status-bar">
          <span>
            {!isBusStopZoomReady
              ? 'Zoom in to see bus stops & stop routes'
              : busStopRoutesCount > 0
                ? `Showing ${busStopRoutesCount} routes through selected stop`
                : `${busStopsCount} bus stops in view`}
          </span>
          {isBusStopZoomReady && busStopsCount > 0 && busStopRoutesCount === 0 && (
            <span className="filter-status-hint">Select stop to see routes</span>
          )}
        </div>
      )}
    </section>
  );
}
