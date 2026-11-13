import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveVehicle, TransitMode, VehicleStats } from '../types/transit.ts';
import { fetchLiveVehicles } from '../services/entur.ts';

const POLL_INTERVAL_MS = 15000;

interface UseLiveVehiclesResult {
  vehicles: LiveVehicle[];
  stats: VehicleStats | null;
  isLoading: boolean;
  hasInitialLoad: boolean;
  error: string | null;
  refresh: () => void;
}

/** Polls Entur live vehicles (Oslo or Norway-wide rail) on a 15s interval with AbortController cleanup. */
export function useLiveVehicles(selectedMode: TransitMode | 'all'): UseLiveVehiclesResult {
  const [vehicles, setVehicles] = useState<LiveVehicle[]>([]);
  const [stats, setStats] = useState<VehicleStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasInitialLoad, setHasInitialLoad] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const loadVehicles = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    try {
      const scope = selectedMode === 'train' ? 'norway-rail' : 'oslo';
      const res = await fetchLiveVehicles({ scope, signal: controller.signal });
      setVehicles(res.vehicles);
      setStats(res.stats);
      setError(null);
      setHasInitialLoad(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to fetch live transit data');
      setHasInitialLoad(true);
    } finally {
      setIsLoading(false);
    }
  }, [selectedMode]);

  useEffect(() => {
    void loadVehicles();
    const timer = window.setInterval(() => {
      void loadVehicles();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [loadVehicles]);

  return {
    vehicles,
    stats,
    isLoading,
    hasInitialLoad,
    error,
    refresh: () => void loadVehicles(),
  };
}
