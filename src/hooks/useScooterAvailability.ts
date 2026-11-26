import { useCallback } from 'react';
import type { MapViewport } from '../types/transit.ts';
import { fetchScooters, SCOOTER_MIN_ZOOM, SCOOTER_OVERVIEW } from '../services/sharedMobility.ts';
import { useRequest } from './useRequest.ts';

export function useScooterAvailability(view: MapViewport | null) {
  const bounds = view?.bbox;
  const outside = bounds && (bounds.minLat < SCOOTER_OVERVIEW.minLat || bounds.maxLat > SCOOTER_OVERVIEW.maxLat
    || bounds.minLon < SCOOTER_OVERVIEW.minLon || bounds.maxLon > SCOOTER_OVERVIEW.maxLon);
  const scope = view && view.zoom >= SCOOTER_MIN_ZOOM && outside ? view.bbox : SCOOTER_OVERVIEW;
  const load = useCallback(async (signal: AbortSignal) => {
    const rows = await fetchScooters(scope, signal);
    return { rows, scope, updated: Date.now() };
  }, [scope]);
  const { latest, data, failed, refresh } = useRequest(load, { interval: 30_000, delay: 180 });
  return { snapshot: latest, current: !!data, failed, retry: refresh };
}
