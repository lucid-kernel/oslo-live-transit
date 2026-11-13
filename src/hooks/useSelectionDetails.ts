import { useCallback, useEffect, useState } from 'react';
import type {
  LiveVehicle,
  NetworkRoute,
  OsloHub,
  StopDeparture,
  TransitMode,
  VehicleJourneyDetails,
} from '../types/transit.ts';
import {
  fetchStopDepartures,
  fetchStopWithRoutes,
  fetchVehicleJourney,
} from '../services/entur.ts';

interface UseSelectionDetailsResult {
  vehicleJourney: VehicleJourneyDetails | null;
  journeyLoading: boolean;
  journeyError: string | null;
  hubDepartures: StopDeparture[];
  busStopRoutes: NetworkRoute[];
  hubLoading: boolean;
  hubError: string | null;
  retryHub: () => void;
}

const HUB_REFRESH_INTERVAL_MS = 30_000;

/** Fetches travel path/stops for a selected vehicle and live departures/routes for a selected stop. */
export function useSelectionDetails(
  selectedVehicle: LiveVehicle | null,
  selectedHub: OsloHub | null,
  selectedMode: TransitMode | 'all',
): UseSelectionDetailsResult {
  const [vehicleJourney, setVehicleJourney] = useState<VehicleJourneyDetails | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [journeyError, setJourneyError] = useState<string | null>(null);

  const [hubDepartures, setHubDepartures] = useState<StopDeparture[]>([]);
  const [busStopRoutes, setBusStopRoutes] = useState<NetworkRoute[]>([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState<string | null>(null);
  const [retrySeq, setRetrySeq] = useState(0);

  const retryHub = useCallback(() => {
    setRetrySeq((seq) => seq + 1);
  }, []);

  useEffect(() => {
    if (!selectedVehicle) {
      setVehicleJourney(null);
      setJourneyLoading(false);
      setJourneyError(null);
      return;
    }

    const controller = new AbortController();
    setJourneyLoading(true);
    setJourneyError(null);

    fetchVehicleJourney(selectedVehicle, controller.signal)
      .then((details) => {
        setVehicleJourney(details);
        setJourneyError(null);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setVehicleJourney(null);
        setJourneyError('Route path temporarily unavailable');
      })
      .finally(() => setJourneyLoading(false));

    return () => controller.abort();
  }, [selectedVehicle]);

  useEffect(() => {
    if (!selectedHub) {
      setHubDepartures([]);
      setHubError(null);
      setBusStopRoutes([]);
      return;
    }

    let activeController: AbortController | null = null;

    const loadHub = (isInitial: boolean) => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      if (isInitial) {
        setHubLoading(true);
        setHubError(null);
      }

      if (selectedMode === 'bus') {
        fetchStopWithRoutes(selectedHub.id, 'bus', controller.signal)
          .then(({ departures, routes }) => {
            setHubDepartures(departures);
            setBusStopRoutes(routes);
            setHubError(null);
          })
          .catch((err) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setHubError(err instanceof Error ? err.message : 'Failed to load bus stop routes');
          })
          .finally(() => setHubLoading(false));
      } else {
        setBusStopRoutes([]);
        fetchStopDepartures(selectedHub.id, { numberOfDepartures: 25, signal: controller.signal })
          .then((deps) => {
            setHubDepartures(deps);
            setHubError(null);
          })
          .catch((err) => {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setHubError(err instanceof Error ? err.message : 'Failed to load hub departures');
          })
          .finally(() => setHubLoading(false));
      }
    };

    loadHub(true);
    const intervalId = window.setInterval(() => loadHub(false), HUB_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      activeController?.abort();
    };
  }, [selectedHub, selectedMode, retrySeq]);

  return {
    vehicleJourney,
    journeyLoading,
    journeyError,
    hubDepartures,
    busStopRoutes,
    hubLoading,
    hubError,
    retryHub,
  };
}
