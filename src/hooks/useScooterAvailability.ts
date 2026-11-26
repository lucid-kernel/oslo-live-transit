import { useEffect, useState } from 'react';
import type { AvailableScooter, BoundingBox } from '../types/transit.ts';
import { fetchScooters, SCOOTER_MIN_ZOOM, SCOOTER_OVERVIEW } from '../services/sharedMobility.ts';

export interface ScooterViewport { bbox: BoundingBox; zoom: number }

export function useScooterAvailability(view: ScooterViewport | null) {
  const bounds = view?.bbox;
  const outside = bounds && (bounds.minLat < SCOOTER_OVERVIEW.minLat || bounds.maxLat > SCOOTER_OVERVIEW.maxLat
    || bounds.minLon < SCOOTER_OVERVIEW.minLon || bounds.maxLon > SCOOTER_OVERVIEW.maxLon);
  const scope = view && view.zoom >= SCOOTER_MIN_ZOOM && outside ? view.bbox : SCOOTER_OVERVIEW;
  const [snapshot, setSnapshot] = useState<{
    rows: AvailableScooter[]; scope: BoundingBox; updated: number;
  } | null>(null);
  const [failedScope, setFailedScope] = useState<BoundingBox | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    const refresh = async () => {
      try {
        const rows = await fetchScooters(scope, controller.signal);
        if (!controller.signal.aborted) {
          setSnapshot({ rows, scope, updated: Date.now() });
          setFailedScope(null);
        }
      } catch {
        if (!controller.signal.aborted) setFailedScope(scope);
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, 30_000);
      }
    };
    timer = window.setTimeout(refresh, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [scope, attempt]);
  return { snapshot, current: snapshot?.scope === scope, failed: failedScope === scope, retry: () => setAttempt(a => a + 1) };
}
