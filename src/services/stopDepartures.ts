import type { BoundingBox, NetworkRoute, NetworkStop, StopDeparture, TransitMode } from '../types/transit.ts';
import { JOURNEY_PLANNER_ENDPOINT, isFlybussen, mapVehicleMode, postGraphQL, readLineColor, type EnturLine } from './enturClient.ts';
import { buildNetworkData } from './networkGeometry.ts';
import { fetchNetworkLinesById } from './networkRoutes.ts';

const STOP_DEPARTURES_QUERY = `
  query StopDepartures($id: String!, $numberOfDepartures: Int!) {
    stopPlace(id: $id) {
      id
      name
      estimatedCalls(numberOfDepartures: $numberOfDepartures) {
        actualDepartureTime
        realtime
        aimedDepartureTime
        expectedDepartureTime
        destinationDisplay {
          frontText
        }
        quay {
          publicCode
        }
        serviceJourney {
          line {
            presentation { colour }
            publicCode
            name
            transportMode
            authority { name }
          }
        }
      }
    }
  }
`;

const STOPS_IN_BBOX_QUERY = `
  query StopsInBbox($minLat: Float!, $maxLat: Float!, $minLon: Float!, $maxLon: Float!) {
    quaysByBbox(
      minimumLatitude: $minLat
      maximumLatitude: $maxLat
      minimumLongitude: $minLon
      maximumLongitude: $maxLon
      filterByInUse: true
    ) {
      id
      name
      latitude
      longitude
      stopPlace { id }
      lines { transportMode publicCode name authority { name } }
    }
  }
`;

const STOP_LINES_QUERY = `
  query StopLines($id: String!) {
    stopPlace(id: $id) {
      id
      quays {
        lines {
          id
          publicCode
          name
          authority { name }
          transportMode
        }
      }
    }
  }
`;

/** Fetches live departures for a stop (`NSR:StopPlace:...`). */
export async function fetchStopDepartures(
  stopPlaceId: string,
  options?: { numberOfDepartures?: number; signal?: AbortSignal },
): Promise<StopDeparture[]> {
  const numberOfDepartures = options?.numberOfDepartures ?? 25;
  const data = await postGraphQL<{
    stopPlace: {
      id: string;
      name: string;
      estimatedCalls: Array<{
        realtime: boolean;
        actualDepartureTime?: string | null;
        aimedDepartureTime: string;
        expectedDepartureTime: string;
        destinationDisplay: { frontText?: string | null } | null;
        quay: { publicCode?: string | null } | null;
        serviceJourney: {
          line: EnturLine | null;
        } | null;
      }>;
    } | null;
  }>(
    JOURNEY_PLANNER_ENDPOINT,
    STOP_DEPARTURES_QUERY,
    { id: stopPlaceId, numberOfDepartures },
    options?.signal,
  );

  const stopPlace = data.stopPlace;
  if (!stopPlace) return [];

  const calls = (stopPlace.estimatedCalls ?? []).filter((call) => !isFlybussen(call.serviceJourney?.line));
  return calls.map((call) => {
    const aimedMs = Date.parse(call.aimedDepartureTime);
    const expectedTime = call.actualDepartureTime ?? call.expectedDepartureTime;
    const expectedMs = Date.parse(expectedTime);
    const delaySeconds =
      Number.isFinite(aimedMs) && Number.isFinite(expectedMs)
        ? Math.round((expectedMs - aimedMs) / 1000)
        : 0;

    const line = call.serviceJourney?.line;
    const lineCode = line?.publicCode ?? '?';

    return {
      stopId: stopPlace.id,
      stopName: stopPlace.name,
      lineCode,
      lineColor: readLineColor(line?.presentation),
      lineName: line?.name ?? lineCode,
      mode: mapVehicleMode(line?.transportMode),
      destination: call.destinationDisplay?.frontText ?? '',
      aimedTime: call.aimedDepartureTime,
      expectedTime,
      delaySeconds,
      realtime: Boolean(call.realtime),
      platform: call.quay?.publicCode ?? null,
    };
  });
}

/** Fetches transit stops within a map viewport bounding box (capped at 250 stops). */
export async function fetchStopsInBounds(
  bbox: BoundingBox,
  mode: 'bus' = 'bus',
  signal?: AbortSignal,
): Promise<NetworkStop[]> {
  const data = await postGraphQL<{
    quaysByBbox: Array<{
      id: string;
      name: string;
      latitude?: number | null;
      longitude?: number | null;
      stopPlace?: { id: string } | null;
      lines: EnturLine[];
    }>;
  }>(
    JOURNEY_PLANNER_ENDPOINT,
    STOPS_IN_BBOX_QUERY,
    {
      minLat: bbox.minLat,
      maxLat: bbox.maxLat,
      minLon: bbox.minLon,
      maxLon: bbox.maxLon,
    },
    signal,
  );

  const stops: NetworkStop[] = [];
  for (const quay of data.quaysByBbox ?? []) {
    if (!quay.stopPlace?.id || typeof quay.latitude !== 'number' || typeof quay.longitude !== 'number') continue;
    if (!quay.lines.some((line) => line.transportMode === mode && !isFlybussen(line))) continue;

    stops.push({
      id: quay.id,
      stopPlaceId: quay.stopPlace.id,
      name: quay.name,
      lat: quay.latitude,
      lon: quay.longitude,
      mode,
    });

    if (stops.length >= 250) break;
  }

  return stops;
}

/** Fetches live departures at a stop along with route polylines of lines passing through it. */
export async function fetchStopWithRoutes(
  stopPlaceId: string,
  mode?: TransitMode,
  signal?: AbortSignal,
): Promise<{ departures: StopDeparture[]; routes: NetworkRoute[] }> {
  const [departures, stopLinesData] = await Promise.all([
    fetchStopDepartures(stopPlaceId, { numberOfDepartures: 20, signal }),
    postGraphQL<{
      stopPlace: {
        id: string;
        quays?: Array<{
          lines?: Array<EnturLine & { id: string }> | null;
        }> | null;
      } | null;
    }>(JOURNEY_PLANNER_ENDPOINT, STOP_LINES_QUERY, { id: stopPlaceId }, signal),
  ]);

  const targetJpMode = mode === 'train' ? 'rail' : mode === 'ferry' ? 'water' : mode;
  const lineIds = Array.from(
    new Set(
      (stopLinesData.stopPlace?.quays ?? [])
        .flatMap((q) => q.lines ?? [])
        .filter((l) => (!targetJpMode || l.transportMode === targetJpMode) && !isFlybussen(l))
        .map((l) => l.id),
    ),
  ).slice(0, 18);

  if (lineIds.length === 0) {
    return { departures, routes: [] };
  }

  const lines = await fetchNetworkLinesById(lineIds, 6, signal);
  const { routes } = buildNetworkData(lines, mode ?? 'bus');
  return { departures, routes };
}
