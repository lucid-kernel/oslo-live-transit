import { useMemo, useState } from 'react';
import type { BoundingBox, OsloHub, TransitMode } from '../types/transit.ts';
import { approxDistKm } from '../services/geo.ts';
import { fetchBikeStations, fetchScooters, NEARBY_METRES, SCOOTER_MIN_ZOOM } from '../services/sharedMobility.ts';
import { disruptedStopsForMode, fetchStopSituations } from '../services/stopNotices.ts';
import { localFeatures } from '../components/map/localLayers.ts';
import { BUS_STOPS_MIN_ZOOM } from './useNetworkOverlays.ts';
import { useLayerFeed } from './useLayerFeed.ts';

export function useLayerPreferences() {
  return useState({ bikes: true, notices: true, scooters: false });
}

export function useLocalLayers(viewport: { bbox: BoundingBox; zoom: number } | null, hub: OsloHub | null, selectedMode: TransitMode | 'all', preferences: ReturnType<typeof useLayerPreferences>) {
  const [enabled, setEnabled] = preferences;
  const bikes = useLayerFeed(enabled.bikes ? fetchBikeStations : null, 30_000);
  const notices = useLayerFeed(enabled.notices ? fetchStopSituations : null, 60_000);

  const viewportLoader = useMemo(() => enabled.scooters && viewport && viewport.zoom >= SCOOTER_MIN_ZOOM
    ? (signal: AbortSignal) => fetchScooters(viewport.bbox, signal) : null, [viewport, enabled.scooters]);
  const nearbyLoader = useMemo(() => enabled.scooters && hub
    ? (signal: AbortSignal) => fetchScooters(hub, signal) : null, [hub, enabled.scooters]);
  const scooters = useLayerFeed(viewportLoader, 30_000);
  const nearbyScooters = useLayerFeed(nearbyLoader, 30_000);

  const disruptedStops = useMemo(() => disruptedStopsForMode(notices?.rows ?? [], selectedMode),
    [notices, selectedMode]);
  const showStops = (viewport?.zoom ?? 0) >= BUS_STOPS_MIN_ZOOM;
  const points = useMemo(() => localFeatures(bikes?.rows ?? [], scooters?.rows ?? [], disruptedStops, showStops),
    [bikes, scooters, disruptedStops, showStops]);
  const nearbyStations = useMemo(() => {
    if (!hub || !bikes) return [];
    return bikes.rows.map(station => ({
      ...station, metres: Math.round(1000 * approxDistKm(station.lon, station.lat, hub.longitude, hub.latitude)),
    })).filter(station => station.metres <= NEARBY_METRES).sort((a, b) => a.metres - b.metres).slice(0, 3);
  }, [hub, bikes]);
  const stopNotices = disruptedStops.find(stop => stop.id === hub?.id)?.notices ?? [];

  return { enabled, setEnabled, bikes, notices, scooters, nearbyScooters, nearbyStations, stopNotices, points };
}

export type LocalLayers = ReturnType<typeof useLocalLayers>;
