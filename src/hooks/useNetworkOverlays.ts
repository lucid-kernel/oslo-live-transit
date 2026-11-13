import { useEffect, useState } from 'react';
import type { BoundingBox, NetworkData, NetworkStop, TransitMode } from '../types/transit.ts';
import { fetchNetworkData, fetchStopsInBounds } from '../services/entur.ts';

export const BUS_STOPS_MIN_ZOOM = 13.0;

interface UseNetworkOverlaysResult {
  networkData: NetworkData | null;
  networkLoading: boolean;
  busStops: NetworkStop[];
}

/** Loads dedicated Metro/Train/Tram network geometry and debounced Bus stops in viewport. */
export function useNetworkOverlays(
  selectedMode: TransitMode | 'all',
  viewport: { bbox: BoundingBox; zoom: number } | null,
): UseNetworkOverlaysResult {
  const [networkData, setNetworkData] = useState<NetworkData | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [busStops, setBusStops] = useState<NetworkStop[]>([]);

  useEffect(() => {
    if (selectedMode !== 'metro' && selectedMode !== 'train' && selectedMode !== 'tram') {
      setNetworkData(null);
      setNetworkLoading(false);
      return;
    }

    const controller = new AbortController();
    setNetworkLoading(true);

    fetchNetworkData(selectedMode, controller.signal)
      .then((data) => setNetworkData(data))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setNetworkData(null);
      })
      .finally(() => setNetworkLoading(false));

    return () => controller.abort();
  }, [selectedMode]);

  useEffect(() => {
    if (selectedMode !== 'bus' || !viewport || viewport.zoom < BUS_STOPS_MIN_ZOOM) {
      setBusStops([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchStopsInBounds(viewport.bbox, 'bus', controller.signal)
        .then((stops) => setBusStops(stops))
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selectedMode, viewport]);

  return { networkData, networkLoading, busStops };
}
