import { useEffect, useState } from 'react';
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
  hubDepartures: StopDeparture[];
  busStopRoutes: NetworkRoute[];
  hubLoading: boolean;
  hubError: string | null;
}

/** Fetches travel path/stops for a selected vehicle and live departures/routes for a selected stop. */
export function useSelectionDetails(
  selectedVehicle: LiveVehicle | null,
  selectedHub: OsloHub | null,
  selectedMode: TransitMode | 'all',
): UseSelectionDetailsResult {
  const [vehicleJourney, setVehicleJourney] = useState<VehicleJourneyDetails | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);

  const [hubDepartures, setHubDepartures] = useState<StopDeparture[]>([]);
  const [busStopRoutes, setBusStopRoutes] = useState<NetworkRoute[]>([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedVehicle) {
      setVehicleJourney(null);
      setJourneyLoading(false);
      return;
    }

    const controller = new AbortController();
    setJourneyLoading(true);

    fetchVehicleJourney(selectedVehicle, controller.signal)
      .then((details) => setVehicleJourney(details))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setVehicleJourney(null);
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

    const controller = new AbortController();
    setHubLoading(true);
    setHubError(null);

    if (selectedMode === 'bus') {
      fetchStopWithRoutes(selectedHub.id, 'bus', controller.signal)
        .then(({ departures, routes }) => {
          setHubDepartures(departures);
          setBusStopRoutes(routes);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setHubError(err instanceof Error ? err.message : 'Failed to load bus stop routes');
        })
        .finally(() => setHubLoading(false));
    } else {
      setBusStopRoutes([]);
      fetchStopDepartures(selectedHub.id, { numberOfDepartures: 25, signal: controller.signal })
        .then((deps) => setHubDepartures(deps))
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setHubError(err instanceof Error ? err.message : 'Failed to load hub departures');
        })
        .finally(() => setHubLoading(false));
    }

    return () => controller.abort();
  }, [selectedHub, selectedMode]);

  return {
    vehicleJourney,
    journeyLoading,
    hubDepartures,
    busStopRoutes,
    hubLoading,
    hubError,
  };
}
