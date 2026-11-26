import { useLanguage } from './i18n/LanguageProvider.tsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type {
  BoundingBox,
  LiveVehicle,
  MapView,
  NetworkData,
  OsloHub,
  RailCategory,
  TransitMode,
} from './types/transit.ts';
import { HeaderBadge } from './components/HeaderBadge.tsx';
import { FilterBar } from './components/FilterBar.tsx';
import { ViewDock } from './components/ViewDock.tsx';
import { VehicleDetailCard } from './components/VehicleDetailCard.tsx';
import { HubDeparturesCard } from './components/HubDeparturesCard.tsx';
import { ScooterView } from './components/ScooterView.tsx';
import { TransitMap, type TransitCamera } from './components/TransitMap.tsx';
import { LocalLayersControl } from './components/LocalLayersControl.tsx';
import { useLayerPreferences, useLocalLayers } from './hooks/useLocalLayers.ts';
import { BootScreen } from './components/BootScreen.tsx';
import { OSLO_HUBS } from './services/entur.ts';
import { useLiveVehicles } from './hooks/useLiveVehicles.ts';
import { BUS_STOPS_MIN_ZOOM, useNetworkOverlays } from './hooks/useNetworkOverlays.ts';
import { useSelectionDetails } from './hooks/useSelectionDetails.ts';

const VALID_MODES: ReadonlySet<string> = new Set(['all', 'bus', 'tram', 'train', 'metro', 'ferry', 'scooter']);
const SHORTCUT_MODE_MAP: Record<string, MapView> = {
  '1': 'all',
  '2': 'bus',
  '3': 'tram',
  '4': 'train',
  '5': 'metro',
  '6': 'ferry',
  '7': 'scooter',
};

function readInitialUrlState(): { mode: MapView; query: string } {
  if (typeof window === 'undefined') return { mode: 'all', query: '' };
  const params = new URLSearchParams(window.location.search);
  const rawMode = params.get('mode') ?? 'all';
  const mode = VALID_MODES.has(rawMode) ? (rawMode as MapView) : 'all';
  const query = params.get('q') ?? '';
  return { mode, query };
}

function matchesSearchQuery(vehicle: LiveVehicle, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return (
    vehicle.lineCode.toLowerCase().includes(normalizedQuery) ||
    vehicle.lineName.toLowerCase().includes(normalizedQuery) ||
    vehicle.destination.toLowerCase().includes(normalizedQuery) ||
    vehicle.operator.toLowerCase().includes(normalizedQuery) ||
    (vehicle.nextStopName?.toLowerCase().includes(normalizedQuery) ?? false)
  );
}

function classifyTrainLine(lineCode: string): RailCategory {
  const code = lineCode.toUpperCase();
  if (code.startsWith('FLY')) return 'airport';
  if (code.startsWith('L')) return 'local';
  if (code.startsWith('F')) return 'long_distance';
  return 'regional';
}

export function App() {
  const [initialUrlState] = useState(readInitialUrlState);
  const [view, setView] = useState(initialUrlState.mode);
  const previousTransit = useRef<TransitMode | 'all'>('all');
  const savedCamera = useRef<TransitCamera | null>(null);
  const preferences = useLayerPreferences();
  const [searchQuery, setSearchQuery] = useState(initialUrlState.query);
  const changeView = (next: MapView) => {
    if (view !== 'scooter') previousTransit.current = view;
    setView(next);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey ||
        (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.matches('input, select, textarea')))) return;
      const next = SHORTCUT_MODE_MAP[event.key];
      if (next) changeView(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (view === 'all') url.searchParams.delete('mode');
    else url.searchParams.set('mode', view);
    if (view === 'scooter' || !searchQuery.trim()) url.searchParams.delete('q');
    else url.searchParams.set('q', searchQuery);
    window.history.replaceState(null, '', url);
  }, [view, searchQuery]);

  if (view === 'scooter') return (
    <main className="app-shell scooter-view">
      <ScooterView />
      <ViewDock selectedMode={view} onSelectMode={changeView} previousTransit={previousTransit.current} stats={null} />
    </main>
  );
  return <TransitView selectedMode={view} setSelectedMode={changeView} searchQuery={searchQuery}
    setSearchQuery={setSearchQuery} savedCamera={savedCamera} preferences={preferences} />;
}

function TransitView({ selectedMode, setSelectedMode, searchQuery, setSearchQuery, savedCamera, preferences }: {
  selectedMode: TransitMode | 'all';
  setSelectedMode: (view: MapView) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  savedCamera: React.RefObject<TransitCamera | null>;
  preferences: ReturnType<typeof useLayerPreferences>;
}) {
  const { m } = useLanguage();
  const [selectedRailCategory, setSelectedRailCategory] = useState<RailCategory | 'all'>('all');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [lastSelectedVehicle, setLastSelectedVehicle] = useState<LiveVehicle | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [fitRouteSeq, setFitRouteSeq] = useState(0);
  const [selectedHub, setSelectedHub] = useState<OsloHub | null>(null);

  const [viewport, setViewport] = useState<{ bbox: BoundingBox; zoom: number } | null>(null);
  const localLayers = useLocalLayers(viewport, selectedHub, selectedMode, preferences);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [bootTimedOut, setBootTimedOut] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setBootTimedOut(true), 20000);
    return () => window.clearTimeout(timer);
  }, []);

  const { vehicles, stats, isLoading, hasInitialLoad, error, refresh } =
    useLiveVehicles(selectedMode);
  const { networkData, networkLoading, busStops } = useNetworkOverlays(selectedMode, viewport);

  const isBooting = !bootTimedOut && !(hasInitialLoad && mapReady);

  const selectedVehicle = useMemo(() => {
    if (!selectedVehicleId) return null;
    return vehicles.find((v) => v.id === selectedVehicleId) ?? lastSelectedVehicle;
  }, [vehicles, selectedVehicleId, lastSelectedVehicle]);

  const {
    vehicleJourney,
    journeyLoading,
    journeyError,
    hubDepartures,
    busStopRoutes,
    hubLoading,
    hubError,
    retryHub,
  } = useSelectionDetails(selectedVehicle, selectedHub, selectedMode);

  useEffect(() => {
    if (selectedMode !== 'train') setSelectedRailCategory('all');
  }, [selectedMode]);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const allMatchingCount = useMemo(() => {
    if (!normalizedQuery) return vehicles.length;
    return vehicles.filter((v) => matchesSearchQuery(v, normalizedQuery)).length;
  }, [vehicles, normalizedQuery]);

  const filteredVehicles = useMemo(() => {
    return vehicles.filter((v) => {
      if (selectedMode !== 'all' && v.mode !== selectedMode) return false;
      if (
        selectedMode === 'train' &&
        selectedRailCategory !== 'all' &&
        classifyTrainLine(v.lineCode) !== selectedRailCategory
      ) {
        return false;
      }
      return matchesSearchQuery(v, normalizedQuery);
    });
  }, [vehicles, selectedMode, selectedRailCategory, normalizedQuery]);

  const activeMapNetworkData = useMemo<NetworkData | null>(() => {
    if (selectedMode === 'bus') {
      if (busStops.length === 0 && busStopRoutes.length === 0) return null;
      return { routes: busStopRoutes, stops: busStops };
    }
    if (!networkData) return null;
    if (selectedMode === 'train' && selectedRailCategory !== 'all') {
      return {
        routes: networkData.routes.filter((r) => r.railCategory === selectedRailCategory),
        stops: networkData.stops,
      };
    }
    return networkData;
  }, [selectedMode, selectedRailCategory, networkData, busStops, busStopRoutes]);

  const handleSelectVehicle = useCallback((vehicle: LiveVehicle | null) => {
    if (!vehicle) {
      setSelectedVehicleId(null);
      setLastSelectedVehicle(null);
      setIsFollowing(false);
      return;
    }
    setSelectedHub(null);
    setSelectedVehicleId(vehicle.id);
    setLastSelectedVehicle(vehicle);
  }, []);

  const handleSelectHub = useCallback((hub: OsloHub | null) => {
    if (!hub) {
      setSelectedHub(null);
      return;
    }
    setSelectedVehicleId(null);
    setLastSelectedVehicle(null);
    setIsFollowing(false);
    setSelectedHub(hub);
  }, []);

  const handleViewportChange = useCallback((bbox: BoundingBox, zoom: number) => {
    setViewport({ bbox, zoom });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedVehicleId || selectedHub) {
          handleSelectVehicle(null);
          handleSelectHub(null);
          return;
        }
        if (searchQuery.trim().length > 0) {
          setSearchQuery('');
          return;
        }
      }

      const target = e.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      if (isEditable || e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedVehicleId, selectedHub, searchQuery, handleSelectVehicle, handleSelectHub]);

  const hasDrawer = Boolean(selectedVehicle || selectedHub);

  return (
    <main className={`app-shell${hasDrawer ? ' has-drawer' : ''}`}>
      <BootScreen
        isVisible={isBooting}
        hasVehicles={hasInitialLoad}
        mapReady={mapReady}
      />

      <TransitMap
        savedCamera={savedCamera}
        localPoints={localLayers.points}
        vehicles={filteredVehicles}
        networkData={activeMapNetworkData}
        vehicleJourney={vehicleJourney}
        selectedVehicleId={selectedVehicleId}
        followVehicleId={isFollowing ? selectedVehicleId : null}
        selectedHubId={selectedHub?.id ?? null}
        shouldFitStopRoutes={
          selectedMode === 'bus' && Boolean(selectedHub) && busStopRoutes.length > 0
        }
        searchQuery={searchQuery}
        fitRouteSeq={fitRouteSeq}
        nationalRail={selectedMode === 'train'}
        onSelectVehicle={handleSelectVehicle}
        onSelectHub={handleSelectHub}
        onStopFollow={() => setIsFollowing(false)}
        onViewportChange={handleViewportChange}
        onMapReady={() => setMapReady(true)}
      />

      <div className="hud-top-left">
        <HeaderBadge
          totalVehicles={stats?.total ?? vehicles.length}
          filteredCount={filteredVehicles.length}
          bySource={stats?.bySource ?? null}
          lastUpdated={stats?.fetchedAt ?? null}
          isLoading={isLoading}
          hasError={error}
          onRefresh={refresh}
        />

        <FilterBar
          selectedMode={selectedMode}
          selectedRailCategory={selectedRailCategory}
          onSelectRailCategory={setSelectedRailCategory}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filteredVehicles={filteredVehicles}
          allMatchingCount={allMatchingCount}
          hubs={OSLO_HUBS}
          onSelectVehicle={handleSelectVehicle}
          onSelectHub={handleSelectHub}
          onResetMode={() => setSelectedMode('all')}
          searchInputRef={searchInputRef}
          networkData={activeMapNetworkData}
          networkLoading={networkLoading}
          busStopsCount={busStops.length}
          busStopRoutesCount={busStopRoutes.length}
          isBusStopZoomReady={Boolean(viewport && viewport.zoom >= BUS_STOPS_MIN_ZOOM)}
        />

        <LocalLayersControl layers={localLayers} zoom={viewport?.zoom ?? 0} />

        {error && (
          <div className="error-banner" role="alert">
            <AlertCircle size={15} />
            <span>{m.liveFailed}</span>
          </div>
        )}
      </div>

      <ViewDock
        selectedMode={selectedMode}
        onSelectMode={setSelectedMode}
        stats={stats}
      />

      {selectedVehicle && (
        <div className="hud-right-drawer">
          <VehicleDetailCard
            key={selectedVehicle.id}
            vehicle={selectedVehicle}
            journey={vehicleJourney}
            journeyLoading={journeyLoading}
            journeyError={journeyError}
            isFollowing={isFollowing}
            onToggleFollow={() => setIsFollowing((prev) => !prev)}
            onFitRoute={() => setFitRouteSeq((seq) => seq + 1)}
            onClose={() => handleSelectVehicle(null)}
          />
        </div>
      )}

      {!selectedVehicle && selectedHub && (
        <div className="hud-right-drawer">
          <HubDeparturesCard
            layers={localLayers}
            key={selectedHub.id}
            hub={selectedHub}
            departures={hubDepartures}
            isLoading={hubLoading}
            error={hubError}
            onRetry={retryHub}
            onClose={() => handleSelectHub(null)}
          />
        </div>
      )}
    </main>
  );
}

export default App;
