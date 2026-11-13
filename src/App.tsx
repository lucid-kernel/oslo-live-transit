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
import { VehicleDetailCard } from './components/VehicleDetailCard.tsx';
import { HubDeparturesCard } from './components/HubDeparturesCard.tsx';
import { TransitMap } from './components/TransitMap.tsx';
import { BootScreen } from './components/BootScreen.tsx';
import { OSLO_CAMERA_PRESETS, type CameraPreset } from './components/transitTheme.ts';
import { useLiveVehicles } from './hooks/useLiveVehicles.ts';
import { BUS_STOPS_MIN_ZOOM, useNetworkOverlays } from './hooks/useNetworkOverlays.ts';
import { useSelectionDetails } from './hooks/useSelectionDetails.ts';

function classifyTrainLine(lineCode: string): RailCategory {
  const code = lineCode.toUpperCase();
  if (code.startsWith('FLY')) return 'airport';
  if (code.startsWith('L')) return 'local';
  if (code.startsWith('F')) return 'long_distance';
  return 'regional';
}

export function App() {
  const [selectedMode, setSelectedMode] = useState<TransitMode | 'all'>('all');
  const [selectedRailCategory, setSelectedRailCategory] = useState<RailCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [lastSelectedVehicle, setLastSelectedVehicle] = useState<LiveVehicle | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [selectedHub, setSelectedHub] = useState<OsloHub | null>(null);

  const [viewport, setViewport] = useState<{ bbox: BoundingBox; zoom: number } | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>(OSLO_CAMERA_PRESETS[0].id);
  const [cameraRequest, setCameraRequest] = useState<{
    preset: CameraPreset;
    seq: number;
  } | null>(null);

  const prevModeRef = useRef<TransitMode | 'all'>('all');
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
    hubDepartures,
    busStopRoutes,
    hubLoading,
    hubError,
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

  const filteredVehicles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (selectedMode !== 'all' && v.mode !== selectedMode) return false;
      if (
        selectedMode === 'train' &&
        selectedRailCategory !== 'all' &&
        classifyTrainLine(v.lineCode) !== selectedRailCategory
      ) {
        return false;
      }
      if (!q) return true;
      return (
        v.lineCode.toLowerCase().includes(q) ||
        v.lineName.toLowerCase().includes(q) ||
        v.destination.toLowerCase().includes(q) ||
        v.operator.toLowerCase().includes(q)
      );
    });
  }, [vehicles, selectedMode, selectedRailCategory, searchQuery]);

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

  return (
    <main className="app-shell">
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
        cameraRequest={cameraRequest}
        onSelectVehicle={handleSelectVehicle}
        onSelectHub={handleSelectHub}
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

      <ViewDock
        selectedMode={selectedMode}
        onSelectMode={setSelectedMode}
        stats={stats}
      />

      {selectedVehicle && (
        <div className="hud-right-drawer">
          <VehicleDetailCard
            vehicle={selectedVehicle}
            journey={vehicleJourney}
            journeyLoading={journeyLoading}
            isFollowing={isFollowing}
            onToggleFollow={() => setIsFollowing((prev) => !prev)}
            onClose={() => handleSelectVehicle(null)}
          />
        </div>
      )}

      {!selectedVehicle && selectedHub && (
        <div className="hud-right-drawer">
          <HubDeparturesCard
            hub={selectedHub}
            departures={hubDepartures}
            isLoading={hubLoading}
            error={hubError}
            onClose={() => handleSelectHub(null)}
          />
        </div>
      )}
    </main>
  );
}

export default App;
