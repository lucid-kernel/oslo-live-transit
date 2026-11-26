import { useMemo } from 'react';
import type { MapViewport, NetworkStop, TransitMode } from '../types/transit.ts';
import { fetchNetworkData, fetchStopsInBounds } from '../services/entur.ts';
import { useRequest } from './useRequest.ts';

export const BUS_STOPS_MIN_ZOOM = 13;
const EMPTY_STOPS: NetworkStop[] = [];

export function useNetworkOverlays(mode: TransitMode | 'all', viewport: MapViewport | null) {
  const loadNetwork = useMemo(() => mode === 'metro' || mode === 'train' || mode === 'tram'
    ? (signal: AbortSignal) => fetchNetworkData(mode, signal)
    : null, [mode]);
  const loadStops = useMemo(() => mode === 'bus' && viewport && viewport.zoom >= BUS_STOPS_MIN_ZOOM
    ? (signal: AbortSignal) => fetchStopsInBounds(viewport.bbox, 'bus', signal)
    : null, [mode, viewport]);
  const network = useRequest(loadNetwork);
  const stops = useRequest(loadStops, { delay: 300 });
  return { networkData: network.data, networkLoading: network.loading, busStops: stops.data ?? EMPTY_STOPS };
}
