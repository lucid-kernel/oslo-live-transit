import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type {
  BoundingBox,
  LiveVehicle,
  NetworkData,
  OsloHub,
  RailCategory,
  TransitMode,
} from './types/transit.ts';
import { HeaderBadge } from './components/HeaderBadge.tsx';
import { FilterBar } from './components/FilterBar.tsx';
import { ViewDock } from './components/ViewDock.tsx';
import { CameraPresets } from './components/CameraPresets.tsx';
import { VehicleDetailCard } from './components/VehicleDetailCard.tsx';
import { HubDeparturesCard } from './components/HubDeparturesCard.tsx';
import { TransitMap } from './components/TransitMap.tsx';
import { BootScreen } from './components/BootScreen.tsx';
import { OSLO_CAMERA_PRESETS, type CameraPreset } from './components/transitTheme.ts';
import { OSLO_HUBS } from './services/entur.ts';
import { useLiveVehicles } from './hooks/useLiveVehicles.ts';
import { BUS_STOPS_MIN_ZOOM, useNetworkOverlays } from './hooks/useNetworkOverlays.ts';
import { useSelectionDetails } from './hooks/useSelectionDetails.ts';

const VALID_MODES: ReadonlySet<string> = new Set(['all', 'bus', 'tram', 'train', 'metro', 'ferry']);
const SHORTCUT_MODE_MAP: Record<string, TransitMode | 'all'> = {
  '1': 'all',
  '2': 'bus',
  '3': 'tram',
  '4': 'train',
  '5': 'metro',
  '6': 'ferry',
};

function readInitialUrlState(): { mode: TransitMode | 'all'; query: string } {
  if (typeof window === 'undefined') return { mode: 'all', query: '' };
  const params = new URLSearchParams(window.location.search);
  const rawMode = params.get('mode') ?? 'all';
  const mode = VALID_MODES.has(rawMode) ? (rawMode as TransitMode | 'all') : 'all';
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
  const [selectedMode, setSelectedMode] = useState<TransitMode | 'all'>(initialUrlState.mode);
  const [selectedRailCategory, setSelectedRailCategory] = useState<RailCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState(initialUrlState.query);

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [lastSelectedVehicle, setLastSelectedVehicle] = useState<LiveVehicle | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [fitRouteSeq, setFitRouteSeq] = useState(0);
  const [selectedHub, setSelectedHub] = useState<OsloHub | null>(null);

  const [viewport, setViewport] = useState<{ bbox: BoundingBox; zoom: number } | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>(OSLO_CAMERA_PRESETS[0].id);
  const [cameraRequest, setCameraRequest] = useState<{
    preset: CameraPreset;
    seq: number;
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const prevModeRef = useRef<TransitMode | 'all'>('all');
  const [mapReady, setMapReady] = useState(false);
  const [bootTimedOut, setBootTimedOut] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setBootTimedOut(true), 20000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (selectedMode === 'all') params.delete('mode');
    else params.set('mode', selectedMode);
    if (searchQuery.trim() === '') params.delete('q');
    else params.set('q', searchQuery);
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', nextUrl);
  }, [selectedMode, searchQuery]);

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

  // Auto-fly to Norway overview when entering Train view, or back to Oslo when leaving Norway
  useEffect(() => {
    const prevMode = prevModeRef.current;
    prevModeRef.current = selectedMode;

    if (selectedMode === 'train' && prevMode !== 'train') {
      const norwayPreset = OSLO_CAMERA_PRESETS.find((p) => p.id === 'norway');
      if (norwayPreset) {
        setActivePresetId(norwayPreset.id);
        setCameraRequest((prev) => ({ preset: norwayPreset, seq: (prev?.seq ?? 0) + 1 }));
      }
      return;
    }

    if (selectedMode !== 'train' && prevMode === 'train') {
      setSelectedRailCategory('all');
      if (activePresetId === 'norway') {
        const osloPreset = OSLO_CAMERA_PRESETS[0];
        setActivePresetId(osloPreset.id);
        setCameraRequest((prev) => ({ preset: osloPreset, seq: (prev?.seq ?? 0) + 1 }));
      }
    }
  }, [selectedMode, activePresetId]);

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

  const handleSelectPreset = useCallback((preset: CameraPreset) => {
    setActivePresetId(preset.id);
    setCameraRequest((prev) => ({ preset, seq: (prev?.seq ?? 0) + 1 }));
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

      const nextMode = SHORTCUT_MODE_MAP[e.key];
      if (nextMode) {
        setSelectedMode(nextMode);
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
        cameraRequest={cameraRequest}
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
          hasError={Boolean(error)}
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

        {error && (
          <div className="error-banner" role="alert">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="hud-bottom-left">
        <CameraPresets activePresetId={activePresetId} onSelectPreset={handleSelectPreset} />
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
