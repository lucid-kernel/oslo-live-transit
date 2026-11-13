import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type {
  BoundingBox,
  LiveVehicle,
  NetworkData,
  NetworkStop,
  OsloHub,
  VehicleJourneyDetails,
} from '../types/transit.ts';
import { OSLO_CENTER, OSLO_HUBS } from '../services/entur.ts';
import {
  formatDelay,
  formatSpeedKmh,
  getVehicleColor,
  MODE_META,
  type CameraPreset,
} from './transitTheme.ts';
import {
  buildJourneyLineFeature,
  buildJourneyStopFeatures,
  buildNetworkRouteFeatures,
  buildNetworkStopFeatures,
  buildVehicleFeatures,
  type VehicleAnimState,
} from './map/geojson.ts';
import { addTransitMapLayers } from './map/mapLayers.ts';
import {
  createGpsTrackMap,
  FRAME_INTERVAL_MS,
  stepVehiclePositions,
  type GpsTrackState,
} from './map/vehicleMotion.ts';

const DARK_MATTER_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

interface TransitMapProps {
  vehicles: LiveVehicle[];
  networkData: NetworkData | null;
  vehicleJourney: VehicleJourneyDetails | null;
  selectedVehicleId: string | null;
  followVehicleId: string | null;
  selectedHubId: string | null;
  cameraRequest: { preset: CameraPreset; seq: number } | null;
  onSelectVehicle: (vehicle: LiveVehicle | null) => void;
  onSelectHub: (hub: OsloHub | null) => void;
  onStopFollow?: () => void;
  onViewportChange?: (bbox: BoundingBox, zoom: number) => void;
  onMapReady?: () => void;
}

interface HoveredInfo {
  vehicle: LiveVehicle;
  x: number;
  y: number;
}

interface HoveredStopInfo {
  stop: NetworkStop;
  x: number;
  y: number;
}

function syncGeoJsonSource(
  map: maplibregl.Map,
  sourceId: string,
  data: Parameters<maplibregl.GeoJSONSource['setData']>[0],
): void {
  const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  source?.setData(data);
}

/** Full-screen MapLibre GL JS transit map with continuous vehicle motion and interactive network layers. */
export function TransitMap({
  vehicles,
  networkData,
  vehicleJourney,
  selectedVehicleId,
  followVehicleId,
  selectedHubId,
  cameraRequest,
  onSelectVehicle,
  onSelectHub,
  onStopFollow,
  onViewportChange,
  onMapReady,
}: TransitMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);

  const vehiclesRef = useRef<LiveVehicle[]>([]);
  const vehiclesByIdRef = useRef<Map<string, LiveVehicle>>(new Map());
  const networkStopsByIdRef = useRef<Map<string, NetworkStop>>(new Map());
  const networkDataRef = useRef<NetworkData | null>(networkData);
  const vehicleJourneyRef = useRef<VehicleJourneyDetails | null>(vehicleJourney);
  const selectedVehicleIdRef = useRef<string | null>(selectedVehicleId);
  const currentPosRef = useRef<Map<string, VehicleAnimState>>(new Map());
  const gpsTrackRef = useRef<Map<string, GpsTrackState>>(new Map());
  const followVehicleIdRef = useRef<string | null>(followVehicleId);
  const userGestureActiveRef = useRef(false);

  networkDataRef.current = networkData;
  vehicleJourneyRef.current = vehicleJourney;
  selectedVehicleIdRef.current = selectedVehicleId;
  followVehicleIdRef.current = followVehicleId;

  const onSelectVehicleRef = useRef(onSelectVehicle);
  const onSelectHubRef = useRef(onSelectHub);
  const onStopFollowRef = useRef(onStopFollow);
  const onViewportChangeRef = useRef(onViewportChange);
  const onMapReadyRef = useRef(onMapReady);
  onSelectVehicleRef.current = onSelectVehicle;
  onSelectHubRef.current = onSelectHub;
  onStopFollowRef.current = onStopFollow;
  onViewportChangeRef.current = onViewportChange;
  onMapReadyRef.current = onMapReady;

  const [hovered, setHovered] = useState<HoveredInfo | null>(null);
  const [hoveredStop, setHoveredStop] = useState<HoveredStopInfo | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_MATTER_STYLE,
      center: [OSLO_CENTER.longitude, OSLO_CENTER.latitude],
      zoom: 11.7,
      pitch: 15,
      bearing: 0,
      maxZoom: 18,
      minZoom: 4.0,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    let animFrameId: number | null = null;
    let lastFramePerf = 0;

    const renderFrame = (nowPerf: number) => {
      animFrameId = requestAnimationFrame(renderFrame);
      if (!mapReadyRef.current || nowPerf - lastFramePerf < FRAME_INTERVAL_MS) return;
      const dtSec = lastFramePerf > 0 ? (nowPerf - lastFramePerf) / 1000 : FRAME_INTERVAL_MS / 1000;
      lastFramePerf = nowPerf;

      const activeVehicles = vehiclesRef.current;
      const { positions, vehiclesById } = stepVehiclePositions(
        activeVehicles,
        gpsTrackRef.current,
        currentPosRef.current,
        nowPerf,
        dtSec,
        Date.now(),
      );

      vehiclesByIdRef.current = vehiclesById;
      currentPosRef.current = positions;
      syncGeoJsonSource(map, 'vehicles', buildVehicleFeatures(activeVehicles, positions));

      if (followVehicleIdRef.current && !userGestureActiveRef.current) {
        const followedPos = positions.get(followVehicleIdRef.current);
        if (followedPos) {
          const center = map.getCenter();
          if (
            Math.abs(center.lng - followedPos.lon) > 1e-6 ||
            Math.abs(center.lat - followedPos.lat) > 1e-6
          ) {
            map.setCenter([followedPos.lon, followedPos.lat]);
          }
        }
      }
    };

    map.on('load', () => {
      addTransitMapLayers(map);

      const vehicleHitLayers = ['vehicles-body', 'vehicles-halo'];
      map.on('mousemove', vehicleHitLayers, (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const vehicle = id ? vehiclesByIdRef.current.get(id) : undefined;
        if (!vehicle) return;

        map.getCanvas().style.cursor = 'pointer';
        setHovered({ vehicle, x: e.originalEvent.clientX, y: e.originalEvent.clientY });
      });

      map.on('mouseleave', vehicleHitLayers, () => {
        map.getCanvas().style.cursor = '';
        setHovered(null);
      });

      map.on('click', vehicleHitLayers, (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const vehicle = id ? vehiclesByIdRef.current.get(id) : undefined;
        if (vehicle) onSelectVehicleRef.current(vehicle);
      });

      map.on('mouseenter', 'hubs-circle', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'hubs-circle', () => {
        map.getCanvas().style.cursor = '';
      });
      map.on('click', 'hubs-circle', (e) => {
        const hubId = e.features?.[0]?.properties?.id as string | undefined;
        const hub = OSLO_HUBS.find((h) => h.id === hubId) ?? null;
        if (hub) onSelectHubRef.current(hub);
      });

      map.on('mousemove', 'network-stops-circle', (e) => {
        const stopId = e.features?.[0]?.properties?.id as string | undefined;
        const stop = stopId ? networkStopsByIdRef.current.get(stopId) : undefined;
        if (!stop) return;

        map.getCanvas().style.cursor = 'pointer';
        setHoveredStop({ stop, x: e.originalEvent.clientX, y: e.originalEvent.clientY });
      });

      map.on('mouseleave', 'network-stops-circle', () => {
        map.getCanvas().style.cursor = '';
        setHoveredStop(null);
      });

      map.on('click', 'network-stops-circle', (e) => {
        const stopId = e.features?.[0]?.properties?.id as string | undefined;
        const stop = stopId ? networkStopsByIdRef.current.get(stopId) : undefined;
        if (stop) {
          onSelectHubRef.current({
            id: stop.id,
            name: stop.name,
            latitude: stop.lat,
            longitude: stop.lon,
          });
        }
      });

      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['vehicles-body', 'vehicles-halo', 'hubs-circle', 'network-stops-circle'],
        });
        if (hits.length === 0) {
          onSelectVehicleRef.current(null);
          onSelectHubRef.current(null);
        }
      });

      const emitViewport = () => {
        const bounds = map.getBounds();
        onViewportChangeRef.current?.(
          {
            minLat: bounds.getSouth(),
            maxLat: bounds.getNorth(),
            minLon: bounds.getWest(),
            maxLon: bounds.getEast(),
          },
          map.getZoom(),
        );
      };

      map.on('movestart', (e) => {
        if (e.originalEvent) userGestureActiveRef.current = true;
      });
      map.on('dragstart', (e) => {
        if (e.originalEvent && followVehicleIdRef.current) {
          didDrag = true;
        }
      });
      map.on('dragend', () => {
        if (didDrag && !multiTouchGesture && followVehicleIdRef.current) {
          onStopFollowRef.current?.();
        }
        didDrag = false;
      });
      map.on('moveend', () => {
        userGestureActiveRef.current = false;
        if (!map.isMoving()) {
          didDrag = false;
          multiTouchGesture = false;
        }
        emitViewport();
      });
      mapReadyRef.current = true;
      onMapReadyRef.current?.();

      // Sync any initial state that arrived before map load completed
      syncGeoJsonSource(map, 'network-routes', buildNetworkRouteFeatures(networkDataRef.current));
      syncGeoJsonSource(map, 'network-stops', buildNetworkStopFeatures(networkDataRef.current));
      syncGeoJsonSource(map, 'vehicles', buildVehicleFeatures(vehiclesRef.current, currentPosRef.current));
      emitViewport();
      animFrameId = requestAnimationFrame(renderFrame);
    });

    mapRef.current = map;

    const canvasContainer = map.getCanvasContainer();
    let wheelIdleTimer: number | null = null;
    let didDrag = false;
    let multiTouchGesture = false;

    const onGestureStart = () => {
      userGestureActiveRef.current = true;
    };
    const onTouchStart = (e: TouchEvent) => {
      userGestureActiveRef.current = true;
      if (e.touches.length >= 2) {
        multiTouchGesture = true;
      } else if (e.touches.length === 1) {
        multiTouchGesture = false;
        didDrag = false;
      }
    };
    const onGestureEnd = () => {
      if (!map.isMoving()) {
        userGestureActiveRef.current = false;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0 && !map.isMoving()) {
        userGestureActiveRef.current = false;
        multiTouchGesture = false;
        didDrag = false;
      }
    };
    const onWheel = () => {
      userGestureActiveRef.current = true;
      if (wheelIdleTimer !== null) window.clearTimeout(wheelIdleTimer);
      wheelIdleTimer = window.setTimeout(() => {
        wheelIdleTimer = null;
        if (!map.isMoving()) {
          userGestureActiveRef.current = false;
        }
      }, 250);
    };

    canvasContainer.addEventListener('pointerdown', onGestureStart, { passive: true, capture: true });
    canvasContainer.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    canvasContainer.addEventListener('pointerup', onGestureEnd, { passive: true, capture: true });
    canvasContainer.addEventListener('pointercancel', onGestureEnd, { passive: true, capture: true });
    canvasContainer.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
    canvasContainer.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true });
    canvasContainer.addEventListener('wheel', onWheel, { passive: true, capture: true });

    return () => {
      if (wheelIdleTimer !== null) window.clearTimeout(wheelIdleTimer);
      canvasContainer.removeEventListener('pointerdown', onGestureStart, { capture: true });
      canvasContainer.removeEventListener('touchstart', onTouchStart, { capture: true });
      canvasContainer.removeEventListener('pointerup', onGestureEnd, { capture: true });
      canvasContainer.removeEventListener('pointercancel', onGestureEnd, { capture: true });
      canvasContainer.removeEventListener('touchend', onTouchEnd, { capture: true });
      canvasContainer.removeEventListener('touchcancel', onTouchEnd, { capture: true });
      canvasContainer.removeEventListener('wheel', onWheel, { capture: true });
      if (animFrameId !== null) cancelAnimationFrame(animFrameId);
      mapReadyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    vehiclesRef.current = vehicles;
    const nowPerf = performance.now();

    const nextById = new Map<string, LiveVehicle>();
    for (const v of vehicles) nextById.set(v.id, v);
    vehiclesByIdRef.current = nextById;
    gpsTrackRef.current = createGpsTrackMap(vehicles, currentPosRef.current, nowPerf);
  }, [vehicles]);

  useEffect(() => {
    const nextStopsById = new Map<string, NetworkStop>();
    if (networkData) {
      for (const s of networkData.stops) nextStopsById.set(s.id, s);
    }
    networkStopsByIdRef.current = nextStopsById;

    if (!mapReadyRef.current || !mapRef.current) return;
    syncGeoJsonSource(mapRef.current, 'network-routes', buildNetworkRouteFeatures(networkData));
    syncGeoJsonSource(mapRef.current, 'network-stops', buildNetworkStopFeatures(networkData));
  }, [networkData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    const selected = selectedVehicleId ? vehiclesByIdRef.current.get(selectedVehicleId) : null;
    const color = selected ? getVehicleColor(selected) : '#38bdf8';

    syncGeoJsonSource(
      map,
      'journey-past',
      buildJourneyLineFeature(vehicleJourney?.pastCoordinates ?? [], '#94a3b8'),
    );
    syncGeoJsonSource(
      map,
      'journey-remaining',
      buildJourneyLineFeature(vehicleJourney?.remainingCoordinates ?? [], color),
    );
    syncGeoJsonSource(map, 'journey-stops', buildJourneyStopFeatures(vehicleJourney, color));
  }, [vehicleJourney, selectedVehicleId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    if (map.getLayer('vehicles-selected-ring')) {
      map.setFilter('vehicles-selected-ring', ['==', ['get', 'id'], selectedVehicleId ?? '']);
    }
  }, [selectedVehicleId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    if (map.getLayer('hubs-circle')) {
      map.setPaintProperty('hubs-circle', 'circle-radius', [
        'case',
        ['==', ['get', 'id'], selectedHubId ?? ''],
        9,
        6,
      ]);
    }
  }, [selectedHubId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cameraRequest) return;
    const { preset } = cameraRequest;
    map.flyTo({
      center: [preset.longitude, preset.latitude],
      zoom: preset.zoom,
      pitch: preset.pitch,
      bearing: preset.bearing,
      duration: 1100,
      essential: true,
    });
  }, [cameraRequest]);

  const hoveredColor = hovered ? getVehicleColor(hovered.vehicle) : '#EF4444';
  const hoveredDelay = hovered ? formatDelay(hovered.vehicle.delaySeconds) : null;

  return (
    <>
      <div ref={containerRef} className="map-container" />

      {hovered && (
        <div
          className="vehicle-tooltip"
          style={{ left: hovered.x, top: hovered.y }}
          role="status"
        >
          <div className="tooltip-top">
            <span className="tooltip-line" style={{ backgroundColor: hoveredColor }}>
              {hovered.vehicle.lineCode}
            </span>
            <span className={`source-badge ${hovered.vehicle.positionSource}`}>
              {hovered.vehicle.positionSource === 'gps' ? 'GPS' : 'EST'}
            </span>
            <span className="tooltip-operator">
              {MODE_META[hovered.vehicle.mode].label} · {hovered.vehicle.operator}
            </span>
          </div>
          <div className="tooltip-dest">{hovered.vehicle.destination}</div>
          <div className="tooltip-stats">
            {hovered.vehicle.nextStopName
              ? `Next: ${hovered.vehicle.nextStopName}`
              : formatSpeedKmh(hovered.vehicle.speed)}
            {hoveredDelay && hoveredDelay.text !== '—' ? ` · ${hoveredDelay.text}` : ''}
          </div>
        </div>
      )}

      {!hovered && hoveredStop && (
        <div
          className="vehicle-tooltip"
          style={{ left: hoveredStop.x, top: hoveredStop.y }}
          role="status"
        >
          <div className="tooltip-top">
            <span
              className="tooltip-line"
              style={{ backgroundColor: MODE_META[hoveredStop.stop.mode].color }}
            >
              {MODE_META[hoveredStop.stop.mode].label}
            </span>
            <span className="tooltip-operator">Station / Stop</span>
          </div>
          <div className="tooltip-dest">{hoveredStop.stop.name}</div>
          <div className="tooltip-stats">
            {hoveredStop.stop.lines?.length
              ? `Lines: ${hoveredStop.stop.lines.join(', ')} · `
              : ''}
            Click for live departures
          </div>
        </div>
      )}
    </>
  );
}
