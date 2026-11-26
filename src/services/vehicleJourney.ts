import type { JourneyStopCall, LiveVehicle, VehicleJourneyDetails } from '../types/transit.ts';
import { JOURNEY_PLANNER_ENDPOINT, postGraphQL } from './enturClient.ts';
import { decodePolyline, findNearestCoordIndex, type LngLat } from './geo.ts';

const SERVICE_JOURNEY_DETAILS_QUERY = `
  query VehicleJourneyDetails($id: String!) {
    serviceJourney(id: $id) {
      id
      line {
        publicCode
      }
      journeyPattern {
        pointsOnLink {
          points
        }
      }
      estimatedCalls {
        aimedArrivalTime
        aimedDepartureTime
        expectedArrivalTime
        expectedDepartureTime
        destinationDisplay {
          frontText
        }
        quay {
          latitude
          longitude
          stopPlace {
            id
            name
            latitude
            longitude
          }
        }
      }
    }
  }
`;

/**
 * Fetches full journey details (past vs remaining polyline & stops, plus terminus ETA)
 * for a selected live vehicle.
 */
export async function fetchVehicleJourney(
  vehicle: LiveVehicle,
  signal?: AbortSignal,
): Promise<VehicleJourneyDetails | null> {
  const sjId =
    vehicle.serviceJourneyId ||
    (vehicle.id.startsWith('est:') ? vehicle.id.slice(4) : undefined);

  if (!sjId) return null;

  const data = await postGraphQL<{
    serviceJourney: {
      id: string;
      line?: { publicCode?: string | null } | null;
      journeyPattern?: { pointsOnLink?: { points?: string | null } | null } | null;
      estimatedCalls?: Array<{
        aimedArrivalTime?: string | null;
        aimedDepartureTime?: string | null;
        expectedArrivalTime?: string | null;
        expectedDepartureTime?: string | null;
        quay?: {
          latitude?: number | null;
          longitude?: number | null;
          stopPlace?: {
            id?: string | null;
            name?: string | null;
            latitude?: number | null;
            longitude?: number | null;
          } | null;
        } | null;
      }> | null;
    } | null;
  }>(JOURNEY_PLANNER_ENDPOINT, SERVICE_JOURNEY_DETAILS_QUERY, { id: sjId }, signal);

  const sj = data.serviceJourney;
  if (!sj) return null;

  const nowMs = Date.now();
  const pastStops: JourneyStopCall[] = [];
  const upcomingStops: JourneyStopCall[] = [];

  for (const call of sj.estimatedCalls ?? []) {
    const quay = call.quay;
    const sp = quay?.stopPlace;
    const point = typeof quay?.latitude === 'number' && typeof quay.longitude === 'number' ? quay : sp;
    if (!sp?.id || typeof point?.latitude !== 'number' || typeof point.longitude !== 'number') {
      continue;
    }
    const expectedTime = call.expectedDepartureTime ?? call.expectedArrivalTime ?? null;
    const aimedTime = call.aimedDepartureTime ?? call.aimedArrivalTime ?? null;
    const checkMs = expectedTime ? Date.parse(expectedTime) : NaN;
    const passed = Number.isFinite(checkMs) ? checkMs <= nowMs : false;

    const stopCall: JourneyStopCall = {
      stopId: sp.id,
      name: sp.name ?? sp.id,
      lat: point.latitude,
      lon: point.longitude,
      aimedTime,
      expectedTime,
      passed,
    };

    if (passed) pastStops.push(stopCall);
    else upcomingStops.push(stopCall);
  }

  const encoded = sj.journeyPattern?.pointsOnLink?.points;
  const allCoords: LngLat[] = encoded
    ? decodePolyline(encoded)
    : [...pastStops, ...upcomingStops].map((s) => [s.lon, s.lat]);

  let pastCoordinates: LngLat[] = [];
  let remainingCoordinates: LngLat[] = [];
  const vehiclePoint: LngLat = [vehicle.longitude, vehicle.latitude];

  if (allCoords.length >= 2) {
    const { idx } = findNearestCoordIndex(allCoords, vehicle.longitude, vehicle.latitude);
    pastCoordinates = [...allCoords.slice(0, idx + 1), vehiclePoint];
    remainingCoordinates = [vehiclePoint, ...allCoords.slice(idx)];
  }

  const lastCall = upcomingStops[upcomingStops.length - 1] ?? pastStops[pastStops.length - 1];

  return {
    vehicleId: vehicle.id,
    lineCode: sj.line?.publicCode ?? vehicle.lineCode,
    destination: vehicle.destination,
    pastCoordinates,
    remainingCoordinates,
    pastStops,
    upcomingStops,
    endStationName: lastCall?.name ?? null,
    endStationEta: lastCall?.expectedTime ?? lastCall?.aimedTime ?? null,
  };
}
