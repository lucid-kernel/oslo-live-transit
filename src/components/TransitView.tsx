import { useLanguage } from '../i18n/LanguageProvider.tsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type {
  MapViewport,
  LiveVehicle,
  MapView,
  NetworkData,
  OsloHub,
  RailCategory,
  TransitMode,
} from '../types/transit.ts';
import { HeaderBadge } from './HeaderBadge.tsx';
import { FilterBar } from './FilterBar.tsx';
import { ViewDock } from './ViewDock.tsx';
import { VehicleDetailCard } from './VehicleDetailCard.tsx';
import { HubDeparturesCard } from './HubDeparturesCard.tsx';
import { TransitMap, type TransitCamera } from './TransitMap.tsx';
import { LocalLayersControl } from './LocalLayersControl.tsx';
import { type useLayerPreferences, useLocalLayers } from '../hooks/useLocalLayers.ts';
import { BootScreen } from './BootScreen.tsx';
import { OSLO_HUBS } from '../services/entur.ts';
import { useLiveVehicles } from '../hooks/useLiveVehicles.ts';
import { BUS_STOPS_MIN_ZOOM, useNetworkOverlays } from '../hooks/useNetworkOverlays.ts';
import { useSelectionDetails } from '../hooks/useSelectionDetails.ts';
import { classifyRailCategory } from '../services/railCategory.ts';

function matchesSearchQuery(vehicle: LiveVehicle, normalizedQuery: string): boolean {
  return (
    vehicle.lineCode.toLowerCase().includes(normalizedQuery) ||
    vehicle.lineName.toLowerCase().includes(normalizedQuery) ||
    vehicle.destination.toLowerCase().includes(normalizedQuery) ||
    vehicle.operator.toLowerCase().includes(normalizedQuery) ||
    (vehicle.nextStopName?.toLowerCase().includes(normalizedQuery) ?? false)
  );
}

type Selection =
  | { kind: 'vehicle'; vehicle: LiveVehicle; following: boolean }
  | { kind: 'hub'; hub: OsloHub };

export function TransitView({ selectedMode, setSelectedMode, searchQuery, setSearchQuery, savedCamera, preferences }: {
  selectedMode: TransitMode | 'all';
  setSelectedMode: (view: MapView) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  savedCamera: React.RefObject<TransitCamera | null>;
  preferences: ReturnType<typeof useLayerPreferences>;
}) {
  const { m } = useLanguage();
  const [selectedRailCategory, setSelectedRailCategory] = useState<RailCategory | 'all'>('all');
  const [selection, setSelection] = useState<Selection | null>(null);
  const selectedHub = selection?.kind === 'hub' ? selection.hub : null;
  const lastSelectedVehicle = selection?.kind === 'vehicle' ? selection.vehicle : null;
  const selectedVehicleId = lastSelectedVehicle?.id ?? null;
  const isFollowing = selection?.kind === 'vehicle' && selection.following;
  const [fitRouteSeq, setFitRouteSeq] = useState(0);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
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

  const matchingVehicles = useMemo(() => normalizedQuery
    ? vehicles.filter(vehicle => matchesSearchQuery(vehicle, normalizedQuery))
    : vehicles, [vehicles, normalizedQuery]);

  const filteredVehicles = useMemo(() => {
    if (selectedMode === 'all') return matchingVehicles;
    return matchingVehicles.filter(vehicle =>
      vehicle.mode === selectedMode &&
      (selectedMode !== 'train' || selectedRailCategory === 'all' || classifyRailCategory(vehicle.lineCode) === selectedRailCategory));
  }, [matchingVehicles, selectedMode, selectedRailCategory]);

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
    setSelection(previous => vehicle
      ? { kind: 'vehicle', vehicle, following: previous?.kind === 'vehicle' && previous.following }
      : null);
  }, []);

  const handleSelectHub = useCallback((hub: OsloHub | null) => {
    setSelection(hub ? { kind: 'hub', hub } : null);
  }, []);

  function toggleFollow() {
    setSelection(previous => previous?.kind === 'vehicle' ? { ...previous, following: !previous.following } : previous);
  }

  function stopFollow() {
    setSelection(previous => previous?.kind === 'vehicle' ? { ...previous, following: false } : previous);
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedVehicleId || selectedHub) {
          setSelection(null);
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
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedVehicleId, selectedHub, searchQuery, setSearchQuery]);

  const hasDrawer = selection !== null;

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
        onStopFollow={stopFollow}
        onViewportChange={setViewport}
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
          allMatchingCount={matchingVehicles.length}
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
            onToggleFollow={toggleFollow}
            onFitRoute={() => setFitRouteSeq((seq) => seq + 1)}
            onClose={() => handleSelectVehicle(null)}
          />
        </div>
      )}

      {selectedHub && (
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
