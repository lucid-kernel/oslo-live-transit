import { useMemo } from 'react';
import type { LiveVehicle, NetworkRoute, OsloHub, StopDeparture, TransitMode } from '../types/transit.ts';
import { fetchStopDepartures, fetchStopWithRoutes, fetchVehicleJourney } from '../services/entur.ts';
import { useRequest } from './useRequest.ts';

const EMPTY_ROUTES: NetworkRoute[] = [];
const EMPTY_DEPARTURES: StopDeparture[] = [];

export function useSelectionDetails(vehicle: LiveVehicle | null, hub: OsloHub | null, mode: TransitMode | 'all') {
  const loadJourney = useMemo(() => vehicle
    ? async (signal: AbortSignal) => ({
      vehicleId: vehicle.id,
      journeyId: vehicle.serviceJourneyId,
      details: await fetchVehicleJourney(vehicle, signal),
    })
    : null, [vehicle]);
  const journey = useRequest(loadJourney);
  const lastJourney = journey.latest;
  const sameJourney = vehicle && lastJourney && lastJourney.vehicleId === vehicle.id && lastJourney.journeyId === vehicle.serviceJourneyId;
  const hubId = hub?.id;
  const includeRoutes = mode === 'bus';
  const loadHub = useMemo(() => {
    if (!hubId) return null;
    return async (signal: AbortSignal) => {
      if (includeRoutes) return fetchStopWithRoutes(hubId, 'bus', signal);
      const departures = await fetchStopDepartures(hubId, { signal });
      return { departures, routes: EMPTY_ROUTES };
    };
  }, [hubId, includeRoutes]);
  const stop = useRequest(loadHub, { interval: 30_000 });

  return {
    vehicleJourney: sameJourney && !journey.failed ? lastJourney.details : null,
    journeyLoading: journey.loading,
    journeyError: journey.failed,
    hubDepartures: stop.data?.departures ?? EMPTY_DEPARTURES,
    busStopRoutes: stop.data?.routes ?? EMPTY_ROUTES,
    hubLoading: stop.loading && !stop.data,
    hubError: stop.failed,
    retryHub: stop.refresh,
  };
}
