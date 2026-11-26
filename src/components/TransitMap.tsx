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
  getBadgeStyle,
  getVehicleColor,
  MODE_META,
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

const OSLO_VIEW: maplibregl.CameraOptions = {
  center: [OSLO_CENTER.longitude, OSLO_CENTER.latitude], zoom: 11.7, pitch: 15, bearing: 0,
};
const NORWAY_VIEW: maplibregl.CameraOptions = {
  center: [10.5, 62.6], zoom: 4.8, pitch: 0, bearing: 0,
};

interface TransitMapProps {
  vehicles: LiveVehicle[];
  networkData: NetworkData | null;
  vehicleJourney: VehicleJourneyDetails | null;
  selectedVehicleId: string | null;
  followVehicleId: string | null;
  selectedHubId: string | null;
  shouldFitStopRoutes?: boolean;
  searchQuery?: string;
  fitRouteSeq?: number;
  nationalRail: boolean;
  onSelectVehicle: (vehicle: LiveVehicle | null) => void;
  onSelectHub: (hub: OsloHub | null) => void;
  onStopFollow?: () => void;
  onViewportChange?: (bbox: BoundingBox, zoom: number) => void;
  onMapReady?: () => void;
}

function syncGeoJsonSource(
  map: maplibregl.Map,
  sourceId: string,
  data: Parameters<maplibregl.GeoJSONSource['setData']>[0],
): void {
  const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  source?.setData(data);
}

function getHudPadding(hasRightDrawer: boolean): maplibregl.PaddingOptions {
  if (typeof window !== 'undefined' && window.innerWidth <= 720) {
    return { top: 132, bottom: 164, left: 28, right: 28 };
  }
  return {
    top: 84,
    bottom: 92,
    left: 56,
    right: hasRightDrawer ? 390 : 56,
  };
}

function fitMapToCoordinates(
  map: maplibregl.Map,
  coords: Array<[number, number]>,
  options: { maxZoom: number; duration?: number; hasRightDrawer?: boolean },
): void {
  if (coords.length === 0) return;
  const bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
  for (let i = 1; i < coords.length; i++) {
    bounds.extend(coords[i]);
  }
  if (bounds.isEmpty()) return;

  map.fitBounds(bounds, {
    padding: getHudPadding(options.hasRightDrawer ?? true),
    maxZoom: options.maxZoom,
    duration: options.duration ?? 850,
    essential: true,
  });
}

/** Full-screen MapLibre GL JS transit map with continuous vehicle motion and interactive network layers. */
export function TransitMap({
  vehicles,
  networkData,
  vehicleJourney,
  selectedVehicleId,
  followVehicleId,
  selectedHubId,
  shouldFitStopRoutes = false,
  searchQuery = '',
  fitRouteSeq = 0,
  nationalRail,
  onSelectVehicle,
  onSelectHub,
  onStopFollow,
  onViewportChange,
  onMapReady,
}: TransitMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const [hoveredVehicle, setHoveredVehicle] = useState<{
    vehicle: LiveVehicle;
    x: number;
    y: number;
  } | null>(null);

  const vehiclesRef = useRef<LiveVehicle[]>([]);
  const vehiclesByIdRef = useRef<Map<string, LiveVehicle>>(new Map());
  const networkStopsByIdRef = useRef<Map<string, NetworkStop>>(new Map());
  const networkDataRef = useRef<NetworkData | null>(networkData);
  const vehicleJourneyRef = useRef<VehicleJourneyDetails | null>(vehicleJourney);
  const selectedVehicleIdRef = useRef<string | null>(selectedVehicleId);
  const selectedHubIdRef = useRef<string | null>(selectedHubId);
  const currentPosRef = useRef<Map<string, VehicleAnimState>>(new Map());
  const gpsTrackRef = useRef<Map<string, GpsTrackState>>(new Map());
  const followVehicleIdRef = useRef<string | null>(followVehicleId);
  const userGestureActiveRef = useRef(false);
  const lastHandledFitSeqRef = useRef(0);
  const lastFittedStopRoutesIdRef = useRef<string | null>(null);
  const prevFollowVehicleIdRef = useRef<string | null>(null);

  networkDataRef.current = networkData;
  vehicleJourneyRef.current = vehicleJourney;
  selectedVehicleIdRef.current = selectedVehicleId;
  selectedHubIdRef.current = selectedHubId;
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

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_MATTER_STYLE,
      ...OSLO_VIEW,
      maxZoom: 18,
      minZoom: 4.0,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(containerRef.current);

    let animFrameId: number | null = null;
    let lastFramePerf = 0;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const renderFrame = (nowPerf: number) => {
      animFrameId = requestAnimationFrame(renderFrame);
      if (!mapReadyRef.current || nowPerf - lastFramePerf < FRAME_INTERVAL_MS) return;
      const dtSec = lastFramePerf > 0 ? (nowPerf - lastFramePerf) / 1000 : FRAME_INTERVAL_MS / 1000;
      lastFramePerf = nowPerf;

      const nowMs = Date.now();
      const activeVehicles = vehiclesRef.current;
      const { positions, vehiclesById } = stepVehiclePositions(
        activeVehicles,
        gpsTrackRef.current,
        currentPosRef.current,
        nowPerf,
        dtSec,
        nowMs,
      );

      vehiclesByIdRef.current = vehiclesById;
      currentPosRef.current = positions;
      syncGeoJsonSource(map, 'vehicles', buildVehicleFeatures(vehiclesById.values(), positions, nowMs, reducedMotion.matches));

      if (followVehicleIdRef.current && !userGestureActiveRef.current && !map.isMoving()) {
        const followedPos = positions.get(followVehicleIdRef.current);
        if (followedPos) {
          const center = map.getCenter();
          const dLng = followedPos.lon - center.lng;
          const dLat = followedPos.lat - center.lat;
          const dist = Math.hypot(dLng, dLat);

          if (dist > 1e-6) {
            // Smoothly glide back after a pinch/zoom; track 1:1 once locked onto the vehicle.
            if (dist < 1.5e-5) {
              map.setCenter([followedPos.lon, followedPos.lat]);
            } else {
              const alpha = 1 - Math.exp(-8 * dtSec);
              map.setCenter([center.lng + dLng * alpha, center.lat + dLat * alpha]);
            }
          }
        }
      }
    };

    map.on('load', () => {
      addTransitMapLayers(map);

      const vehicleHitLayers = ['vehicles-body', 'vehicles-halo'];
      const canHover = () =>
        typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

      map.on('mouseenter', vehicleHitLayers, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mousemove', vehicleHitLayers, (e) => {
        if (!canHover()) return;
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const vehicle = id ? vehiclesByIdRef.current.get(id) : undefined;
        const rect = containerRef.current?.getBoundingClientRect();
        if (vehicle && rect) {
          setHoveredVehicle({
            vehicle,
            x: rect.left + e.point.x,
            y: rect.top + e.point.y,
          });
        } else {
          setHoveredVehicle(null);
        }
      });
      map.on('mouseleave', vehicleHitLayers, () => {
        map.getCanvas().style.cursor = '';
        setHoveredVehicle(null);
      });

      map.on('click', vehicleHitLayers, (e) => {
        setHoveredVehicle(null);
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
        if (hub) {
          onSelectHubRef.current(hub);
          if (map.getZoom() < 13.0) {
            map.easeTo({
              center: [hub.longitude, hub.latitude],
              zoom: 13.5,
              duration: 650,
              essential: true,
            });
          }
        }
      });

      map.on('mouseenter', 'network-stops-circle', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'network-stops-circle', () => {
        map.getCanvas().style.cursor = '';
      });

      map.on('click', 'network-stops-circle', (e) => {
        const stopId = e.features?.[0]?.properties?.id as string | undefined;
        const stop = stopId ? networkStopsByIdRef.current.get(stopId) : undefined;
        if (stop) {
          onSelectHubRef.current({
            id: stop.stopPlaceId ?? stop.id,
            name: stop.name,
            latitude: stop.lat,
            longitude: stop.lon,
          });
          if (map.getZoom() < 13.0 && stop.mode !== 'bus') {
            map.easeTo({
              center: [stop.lon, stop.lat],
              zoom: 13.5,
              duration: 650,
              essential: true,
            });
          }
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
        setHoveredVehicle(null);
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
      syncGeoJsonSource(map, 'vehicles', buildVehicleFeatures(vehiclesRef.current, currentPosRef.current, Date.now(), reducedMotion.matches));
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
      resizeObserver.disconnect();
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
    if (!map || !mapReadyRef.current || !selectedVehicleId || followVehicleIdRef.current) return;

    const pos = currentPosRef.current.get(selectedVehicleId);
    const vehicle = vehiclesByIdRef.current.get(selectedVehicleId);
    const lon = pos?.lon ?? vehicle?.longitude;
    const lat = pos?.lat ?? vehicle?.latitude;
    if (lon === undefined || lat === undefined) return;

    const bounds = map.getBounds();
    const isOutsideView = !bounds.contains([lon, lat]);
    const isTooZoomedOut = map.getZoom() < 11.5;

    if (isOutsideView || isTooZoomedOut) {
      map.easeTo({
        center: [lon, lat],
        zoom: Math.max(map.getZoom(), 13.0),
        duration: 500,
        essential: true,
      });
    }
  }, [selectedVehicleId]);

  useEffect(() => {
    if (!fitRouteSeq || fitRouteSeq === lastHandledFitSeqRef.current) return;
    lastHandledFitSeqRef.current = fitRouteSeq;

    const map = mapRef.current;
    const journey = vehicleJourneyRef.current;
    if (!map || !mapReadyRef.current || !journey) return;

    const routeCoords: Array<[number, number]> = [
      ...journey.pastCoordinates,
      ...journey.remainingCoordinates,
    ];
    if (routeCoords.length < 2) {
      for (const s of [...journey.pastStops, ...journey.upcomingStops]) {
        routeCoords.push([s.lon, s.lat]);
      }
    }
    if (routeCoords.length >= 2) {
      fitMapToCoordinates(map, routeCoords, {
        maxZoom: 14.2,
        duration: 750,
        hasRightDrawer: true,
      });
    }
  }, [fitRouteSeq]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    if (!selectedHubId || !shouldFitStopRoutes) {
      if (!selectedHubId) lastFittedStopRoutesIdRef.current = null;
      return;
    }

    if (
      networkData &&
      networkData.routes.length > 0 &&
      lastFittedStopRoutesIdRef.current !== selectedHubId
    ) {
      const routeCoords = networkData.routes.flatMap((r) => r.coordinates);
      if (routeCoords.length >= 2) {
        lastFittedStopRoutesIdRef.current = selectedHubId;
        fitMapToCoordinates(map, routeCoords, {
          maxZoom: 13.8,
          duration: 900,
          hasRightDrawer: true,
        });
      }
    }
  }, [networkData, selectedHubId, shouldFitStopRoutes]);

  useEffect(() => {
    const map = mapRef.current;
    const prev = prevFollowVehicleIdRef.current;
    prevFollowVehicleIdRef.current = followVehicleId;

    if (!map || !mapReadyRef.current || !followVehicleId || followVehicleId === prev) return;
    const pos = currentPosRef.current.get(followVehicleId);
    if (!pos) return;

    if (map.getZoom() < 13.6) {
      map.easeTo({
        center: [pos.lon, pos.lat],
        zoom: 14.4,
        duration: 650,
        essential: true,
      });
    }
  }, [followVehicleId]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) return;

    const timer = window.setTimeout(() => {
      const map = mapRef.current;
      if (!map || !mapReadyRef.current) return;

      const matching = vehiclesRef.current;
      if (matching.length === 0) return;

      const coords: Array<[number, number]> = matching.map((v) => [
        v.longitude,
        v.latitude,
      ]);
      fitMapToCoordinates(map, coords, {
        maxZoom: 14.0,
        duration: 800,
        hasRightDrawer: Boolean(selectedVehicleIdRef.current || selectedHubIdRef.current),
      });
    }, 320);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    if (map.getLayer('vehicles-selected-ring')) {
      map.setFilter('vehicles-selected-ring', ['==', ['get', 'id'], selectedVehicleId ?? '']);
    }

    if (selectedVehicleId) {
      if (map.getLayer('vehicles-halo')) {
        map.setPaintProperty('vehicles-halo', 'circle-opacity', [
          'case',
          ['==', ['get', 'id'], selectedVehicleId],
          0.34,
          0.05,
        ]);
      }
      if (map.getLayer('vehicles-body')) {
        map.setPaintProperty('vehicles-body', 'circle-opacity', [
          'case',
          ['==', ['get', 'id'], selectedVehicleId],
          ['case', ['==', ['get', 'positionSource'], 'estimated'], 0.9, 1],
          0.2,
        ]);
        map.setPaintProperty('vehicles-body', 'circle-stroke-opacity', [
          'case',
          ['==', ['get', 'id'], selectedVehicleId],
          1,
          0.2,
        ]);
      }
      if (map.getLayer('vehicles-heading')) {
        map.setPaintProperty('vehicles-heading', 'icon-opacity', [
          'case',
          ['==', ['get', 'id'], selectedVehicleId],
          1,
          0.18,
        ]);
      }
      if (map.getLayer('vehicles-label')) {
        map.setPaintProperty('vehicles-label', 'text-opacity', [
          'case',
          ['==', ['get', 'id'], selectedVehicleId],
          1,
          0.2,
        ]);
      }
    } else {
      if (map.getLayer('vehicles-halo')) {
        map.setPaintProperty('vehicles-halo', 'circle-opacity', 0.2);
      }
      if (map.getLayer('vehicles-body')) {
        map.setPaintProperty('vehicles-body', 'circle-opacity', [
          'case',
          ['==', ['get', 'positionSource'], 'estimated'],
          0.82,
          1,
        ]);
        map.setPaintProperty('vehicles-body', 'circle-stroke-opacity', 1);
      }
      if (map.getLayer('vehicles-heading')) {
        map.setPaintProperty('vehicles-heading', 'icon-opacity', 1);
      }
      if (map.getLayer('vehicles-label')) {
        map.setPaintProperty('vehicles-label', 'text-opacity', 1);
      }
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
    if (selectedHubId) {
      const hub = OSLO_HUBS.find((h) => h.id === selectedHubId);
      if (hub && (!map.getBounds().contains([hub.longitude, hub.latitude]) || map.getZoom() < 13.0)) {
        map.easeTo({
          center: [hub.longitude, hub.latitude],
          zoom: Math.max(map.getZoom(), 13.5),
          duration: 650,
          essential: true,
        });
      }
    }
  }, [selectedHubId]);

  useEffect(() => {
    mapRef.current?.flyTo({
      ...(nationalRail ? NORWAY_VIEW : OSLO_VIEW),
      duration: 1100,
      essential: true,
    });
  }, [nationalRail]);

  const tooltipVehicle =
    hoveredVehicle && hoveredVehicle.vehicle.id !== selectedVehicleId
      ? hoveredVehicle
      : null;

  return (
    <>
      <div ref={containerRef} className="map-container" />
      {tooltipVehicle && (
        <div
          className="vehicle-tooltip"
          style={{
            left:
              typeof window !== 'undefined' && tooltipVehicle.x > window.innerWidth - 280
                ? tooltipVehicle.x - 270
                : tooltipVehicle.x,
            top: tooltipVehicle.y,
          }}
          role="status"
        >
          <div className="tooltip-top">
            <span
              className="tooltip-line"
              style={getBadgeStyle(getVehicleColor(tooltipVehicle.vehicle))}
            >
              {tooltipVehicle.vehicle.lineCode}
            </span>
            <span className="tooltip-operator">
              {MODE_META[tooltipVehicle.vehicle.mode].label} · {tooltipVehicle.vehicle.operator}
            </span>
          </div>
          <div className="tooltip-dest">{tooltipVehicle.vehicle.destination}</div>
          <div className="tooltip-stats">
            {formatSpeedKmh(tooltipVehicle.vehicle.speed)}
            {formatDelay(tooltipVehicle.vehicle.delaySeconds).text !== '—'
              ? ` · ${formatDelay(tooltipVehicle.vehicle.delaySeconds).text}`
              : ''}
            {tooltipVehicle.vehicle.nextStopName
              ? ` · Next: ${tooltipVehicle.vehicle.nextStopName}`
              : ''}
          </div>
        </div>
      )}
    </>
  );
}
