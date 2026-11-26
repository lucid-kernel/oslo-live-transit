import { locales, number } from '../i18n/language.ts';
import { useLanguage } from '../i18n/LanguageProvider.tsx';
import { useEffect, useMemo, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';
import { ListFilter, Search, X } from 'lucide-react';
import type { LiveVehicle, NetworkData, OsloHub, RailCategory, TransitMode } from '../types/transit.ts';
import { SearchResultOption, type SearchResultEntry } from './SearchResultOption.tsx';

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
  const { m, language } = useLanguage();
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
    const lineOrder = new Intl.Collator(locales[language], { numeric: true });
    return [...filteredVehicles]
      .sort((a, b) =>
        lineOrder.compare(a.lineCode, b.lineCode) ||
        a.destination.localeCompare(b.destination, locales[language]),
      )
      .slice(0, limit);
  }, [filteredVehicles, q, language]);

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
      aria-label={m.searchOptions}
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
            placeholder={m.searchPlaceholder}
            aria-label={m.searchLabel}
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
              aria-label={m.clearSearch}
              title={m.clearSearch}
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
          aria-label={m.browse}
          title={m.browseTitle}
        >
          <ListFilter size={15} />
        </button>
      </div>

      {isDropdownOpen && (
        <div
          id="transit-search-results"
          className="search-results-panel"
          role="listbox"
          aria-label={m.matches}
        >
          {resultEntries.map((entry, idx) => (
            <SearchResultOption key={entry.key} entry={entry} active={idx === activeIndex} onSelect={selectEntry} />
          ))}
        </div>
      )}

      {showEmptyState && (
        <div className="empty-state-card" role="status" aria-live="polite">
          <div className="empty-state-title">
            {allMatchingCount > 0 && selectedMode !== 'all'
              ? m.noInMode(searchQuery.trim(), m[selectedMode])
              : m.noMatches(searchQuery.trim())}
          </div>
          <div className="empty-state-actions">
            {allMatchingCount > 0 && selectedMode !== 'all' && (
              <button type="button" className="empty-action-primary" onClick={onResetMode}>
                {m.showAll(number(allMatchingCount, language))}
              </button>
            )}
            <button
              type="button"
              className="empty-action-secondary"
              onClick={() => onSearchChange('')}
            >
              {m.clearSearch}
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
        <div className="mode-pills" role="group" aria-label={m.railFilter}>
          <button
            type="button"
            aria-pressed={selectedRailCategory === 'all'}
            className={`mode-pill${selectedRailCategory === 'all' ? ' active' : ''}`}
            onClick={() => onSelectRailCategory('all')}
          >
            {m.allRail}
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
              {m[cat]}
            </button>
          ))}
        </div>
      )}

      {isNetworkMode && (
        <div className="filter-status-bar">
          <span>
            {networkLoading
              ? m.networkLoading(m[selectedMode])
              : networkData
                ? m.networkDetails(selectedMode === 'train' ? m.nationalRail : m[selectedMode], m.lineCount(networkData.routes.length), m.stopCount(networkData.stops.length))
                : m.network(m[selectedMode])}
          </span>
          {!networkLoading && networkData && (
            <span className="filter-status-hint">{m.selectDepartures}</span>
          )}
        </div>
      )}

      {selectedMode === 'bus' && (
        <div className="filter-status-bar">
          <span>
            {!isBusStopZoomReady
              ? m.zoomBus
              : busStopRoutesCount > 0
                ? m.stopRoutes(busStopRoutesCount)
                : m.busStopCount(busStopsCount)}
          </span>
          {isBusStopZoomReady && busStopsCount > 0 && busStopRoutesCount === 0 && (
            <span className="filter-status-hint">{m.selectRoutes}</span>
          )}
        </div>
      )}
    </section>
  );
}
