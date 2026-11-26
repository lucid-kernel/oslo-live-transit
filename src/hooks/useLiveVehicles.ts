import { useCallback, useEffect, useState } from 'react';
import { fetchLiveVehicles } from '../services/entur.ts';
import type { LiveVehicle, TransitMode } from '../types/transit.ts';
import { useRequest } from './useRequest.ts';

const EMPTY_VEHICLES: LiveVehicle[] = [];

export function useLiveVehicles(selectedMode: TransitMode | 'all') {
  const scope = selectedMode === 'train' ? 'norway-rail' : 'oslo';
  const load = useCallback((signal: AbortSignal) => fetchLiveVehicles({ scope, signal }), [scope]);
  const { data, loading, failed, refresh } = useRequest(load, { interval: 15_000 });
  const [hasInitialLoad, setHasInitialLoad] = useState(false);
  useEffect(() => {
    if (data || failed) setHasInitialLoad(true);
  }, [data, failed]);

  return {
    vehicles: data?.vehicles ?? EMPTY_VEHICLES,
    stats: data?.stats ?? null,
    isLoading: loading,
    hasInitialLoad,
    error: failed,
    refresh,
  };
}
