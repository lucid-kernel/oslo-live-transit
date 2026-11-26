import { useMapLanguage } from './map/mapLanguage.ts';
import { useLanguage } from '../i18n/LanguageProvider.tsx';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type {
  MapViewport,
  LiveVehicle,
  NetworkData,
  OsloHub,
  VehicleJourneyDetails,
} from '../types/transit.ts';
import { OSLO_CENTER, OSLO_HUBS } from '../services/entur.ts';
import {
  formatDelay,
  formatSpeedKmh,
  getBadgeStyle,
  getVehicleColor,
} from './transitTheme.ts';
import {
  buildJourneyLineFeature,
  buildJourneyStopFeatures,
  buildNetworkRouteFeatures,
  buildNetworkStopFeatures,
} from './map/geojson.ts';
import { setLocalPopupContent } from './map/localPopup.ts';
import { addLocalLayers, LOCAL_LAYERS } from './map/localLayers.ts';
import type { PointFeatureCollection } from './map/geojson.ts';
import { addTransitMapLayers, DARK_MATTER_STYLE } from './map/mapLayers.ts';
import { bindFollowGestures } from './map/followGestures.ts';
import { readViewport } from './map/viewport.ts';
import { useVehicleAnimation } from './map/useVehicleAnimation.ts';
import { styleSelectedVehicle } from './map/selectionStyle.ts';

const VEHICLE_LAYERS = ['vehicles-body', 'vehicles-halo'];
const OSLO_VIEW: maplibregl.CameraOptions = {
  center: [OSLO_CENTER.longitude, OSLO_CENTER.latitude], zoom: 11.7, pitch: 15, bearing: 0,
};
const NORWAY_VIEW: maplibregl.CameraOptions = {
  center: [10.5, 62.6], zoom: 4.8, pitch: 0, bearing: 0,
};

export interface TransitCamera {
  nationalRail: boolean;
  camera: maplibregl.CameraOptions;
}

interface TransitMapProps {
  savedCamera: React.RefObject<TransitCamera | null>;
  localPoints: PointFeatureCollection;
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
  onViewportChange?: (viewport: MapViewport) => void;
  onMapReady?: () => void;
}

function syncGeoJsonSource(
  map: maplibregl.Map,
  sourceId: string,
  data: Parameters<maplibregl.GeoJSONSource['setData']>[0],
): void {
  map.getSource<maplibregl.GeoJSONSource>(sourceId)?.setData(data);
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
  savedCamera,
  localPoints,
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
  const { m, language } = useLanguage();
  const initialCamera = useRef(savedCamera.current?.nationalRail === nationalRail ? savedCamera.current.camera : null);
  const fittedQuery = useRef(initialCamera.current ? searchQuery : null);
  const lastNationalRail = useRef(nationalRail);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [hoveredVehicle, setHoveredVehicle] = useState<{
    vehicle: LiveVehicle;
    x: number;
    y: number;
  } | null>(null);

  const localPopupRef = useRef<{ popup: maplibregl.Popup; id: string; kind: string } | null>(null);
  useEffect(() => {
    if (!map) return;
    syncGeoJsonSource(map, 'local-layers', localPoints);
    const selection = localPopupRef.current;
    if (!selection?.popup.isOpen()) return;
    const feature = localPoints.features.find(({ properties }) =>
      properties.kind === selection.kind && properties.id === selection.id);
    if (feature) {
      selection.popup.setLngLat(feature.geometry.coordinates);
      setLocalPopupContent(selection.popup, feature.properties, language);
    } else {
      selection.popup.remove();
    }
  }, [map, localPoints, language]);

  const gesture = useRef(false);
  const { vehiclesByIdRef, currentPosRef } = useVehicleAnimation(map, vehicles, followVehicleId, gesture);
  const lastHandledFitSeqRef = useRef(0);
  const lastFittedStopRoutesIdRef = useRef<string | null>(null);

  const following = useEffectEvent(() => !!followVehicleId);
  const stopFollow = useEffectEvent(() => onStopFollow?.());
  const emitViewport = useEffectEvent((map: maplibregl.Map) => onViewportChange?.(readViewport(map)));
  const ready = useEffectEvent(() => onMapReady?.());
  const click = useEffectEvent((map: maplibregl.Map, e: maplibregl.MapMouseEvent, selectableLayers: string[]) => {
    const [hit] = map.queryRenderedFeatures(e.point, { layers: selectableLayers });
    localPopupRef.current?.popup.remove();
    setHoveredVehicle(null);
    if (!hit || hit.geometry.type !== 'Point') {
      onSelectVehicle(null);
      onSelectHub(null);
      return;
    }
    const { id, kind, label } = hit.properties;
    const [lon, lat] = hit.geometry.coordinates;
    if (kind === 'bike-stations' || kind === 'available-scooters' || kind === 'notice-overview') {
      const popup = new maplibregl.Popup({ className: 'mobility-popup', offset: 9 })
        .setLngLat([lon, lat]);
      setLocalPopupContent(popup, hit.properties, language);
      popup.addTo(map);
      localPopupRef.current = { popup, id, kind };
      return;
    }
    if (VEHICLE_LAYERS.includes(hit.layer.id)) {
      const vehicle = vehiclesByIdRef.current.get(id);
      if (vehicle) onSelectVehicle(vehicle);
      return;
    }
    const stop = networkData?.stops.find(stop => stop.id === id);
    let hub: OsloHub | undefined;
    if (hit.layer.id === 'stop-notices') {
      hub = { id, name: label, latitude: lat, longitude: lon };
    } else if (hit.layer.id === 'hubs-circle') {
      hub = OSLO_HUBS.find(h => h.id === id);
    } else if (stop) {
      hub = { id: stop.stopPlaceId ?? stop.id, name: stop.name, latitude: stop.lat, longitude: stop.lon };
    }
    if (hub) {
      onSelectHub(hub);
      if (map.getZoom() < 13 && stop?.mode !== 'bus') {
        map.easeTo({ center: [hub.longitude, hub.latitude], zoom: 13.5, duration: 650, essential: true });
      }
    }
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_MATTER_STYLE,
      ...(initialCamera.current ?? (nationalRail ? NORWAY_VIEW : OSLO_VIEW)),
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

    const releaseGestures = bindFollowGestures(map, gesture, following, stopFollow);
    mapRef.current = map;
    map.on('load', () => {
      addTransitMapLayers(map);
      addLocalLayers(map);
      const canHover = () =>
        typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

      map.on('mousemove', VEHICLE_LAYERS, (e) => {
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
      map.on('mouseleave', VEHICLE_LAYERS, () => {
        setHoveredVehicle(null);
      });

      const selectableLayers = [...VEHICLE_LAYERS, 'hubs-circle', 'network-stops-circle', ...LOCAL_LAYERS];
      map.on('mouseenter', selectableLayers, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', selectableLayers, () => { map.getCanvas().style.cursor = ''; });
      map.on('click', e => click(map, e, selectableLayers));
      map.on('movestart', () => setHoveredVehicle(null));
      map.on('moveend', () => emitViewport(map));
      setMap(map);
      emitViewport(map);
      ready();
    });

    return () => {
      releaseGestures();
      resizeObserver.disconnect();
      savedCamera.current = { nationalRail: lastNationalRail.current, camera: {
        center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(),
      } };
      map.remove();
      mapRef.current = null;
    };
  }, []);
  useMapLanguage(mapRef, language, m.map);

  useEffect(() => {
    if (!map) return;
    syncGeoJsonSource(map, 'network-routes', buildNetworkRouteFeatures(networkData));
    syncGeoJsonSource(map, 'network-stops', buildNetworkStopFeatures(networkData));
  }, [map, networkData]);

  useEffect(() => {
    if (!map) return;

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
  }, [map, vehicleJourney, selectedVehicleId]);

  useEffect(() => {
    if (!map || !selectedVehicleId || following()) return;

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
  }, [map, selectedVehicleId]);

  useEffect(() => {
    if (!fitRouteSeq || fitRouteSeq === lastHandledFitSeqRef.current) return;

    const journey = vehicleJourney;
    if (!map || !journey) return;
    lastHandledFitSeqRef.current = fitRouteSeq;

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
  }, [map, fitRouteSeq, vehicleJourney]);

  useEffect(() => {
    if (!map) return;

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
  }, [map, networkData, selectedHubId, shouldFitStopRoutes]);

  useEffect(() => {

    if (!map || !followVehicleId) return;
    const vehicle = vehiclesByIdRef.current.get(followVehicleId);
    const pos = currentPosRef.current.get(followVehicleId) ?? (vehicle && { lon: vehicle.longitude, lat: vehicle.latitude });
    if (!pos) return;

    if (map.getZoom() < 13.6) {
      map.easeTo({
        center: [pos.lon, pos.lat],
        zoom: 14.4,
        duration: 650,
        essential: true,
      });
    }
  }, [map, followVehicleId]);

  const fitSearch = useEffectEvent(() => {
    if (!map || !vehicles.length) return;
    fitMapToCoordinates(map, vehicles.map(v => [v.longitude, v.latitude]), {
      maxZoom: 14, duration: 800, hasRightDrawer: Boolean(selectedVehicleId || selectedHubId),
    });
    fittedQuery.current = searchQuery;
  });
  const hasMatches = vehicles.length > 0;
  useEffect(() => {
    if (fittedQuery.current === searchQuery) return;
    fittedQuery.current = null;
    if (!map || !hasMatches || !searchQuery.trim()) return;
    const timer = window.setTimeout(fitSearch, 320);
    return () => window.clearTimeout(timer);
  }, [map, searchQuery, hasMatches]);

  useEffect(() => {
    if (map) styleSelectedVehicle(map, selectedVehicleId);
  }, [map, selectedVehicleId]);

  useEffect(() => {
    if (!map) return;
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
  }, [map, selectedHubId]);

  useEffect(() => {
    if (lastNationalRail.current === nationalRail) return;
    lastNationalRail.current = nationalRail;
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
              {m[tooltipVehicle.vehicle.mode]} · {tooltipVehicle.vehicle.operator || m.unknownOperator}
            </span>
          </div>
          <div className="tooltip-dest">{tooltipVehicle.vehicle.destination || m.inService}</div>
          <div className="tooltip-stats">
            {formatSpeedKmh(tooltipVehicle.vehicle.speed, language)}
            {formatDelay(tooltipVehicle.vehicle.delaySeconds, language).text !== '—'
              ? ` · ${formatDelay(tooltipVehicle.vehicle.delaySeconds, language).text}`
              : ''}
            {tooltipVehicle.vehicle.nextStopName
              ? ` · ${m.next(tooltipVehicle.vehicle.nextStopName)}`
              : ''}
          </div>
        </div>
      )}
    </>
  );
}
