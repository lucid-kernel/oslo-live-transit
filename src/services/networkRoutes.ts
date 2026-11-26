import type {
  BoundingBox,
  JourneyStopCall,
  LiveVehicle,
  NetworkData,
  NetworkRoute,
  NetworkStop,
  RailCategory,
  StopDeparture,
  TransitMode,
  VehicleJourneyDetails,
} from '../types/transit.ts';
import {
  JOURNEY_PLANNER_ENDPOINT,
  isFlybussen,
  readLineColor,
  type LinePresentation,
  mapVehicleMode,
  type EnturLine,
  postGraphQL,
  postGraphQLBatched,
} from './enturClient.ts';
import {
  approxDistKm,
  decodePolyline,
  extractUncoveredSegments,
  findNearestCoordIndex,
  isWithinBbox,
  maxSegmentJumpKm,
  type LngLat,
} from './geo.ts';

const NORWAY_RAIL_BBOX: BoundingBox = {
  minLat: 57.9,
  maxLat: 71.2,
  minLon: 4.0,
  maxLon: 31.5,
};

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

const NETWORK_LINES_BY_MODE_QUERY = `
  query NetworkLinesByMode($authorities: [String], $modes: [TransportMode]) {
    lines(authorities: $authorities, transportModes: $modes) {
      id
      publicCode
      name
      transportMode
      authority {
        name
      }
      journeyPatterns {
        id
        name
        pointsOnLink {
          points
        }
      }
      quays {
        stopPlace {
          id
          name
          latitude
          longitude
        }
      }
    }
  }
`;

const NORWAY_RAIL_LINES_QUERY = `
  query NorwayRailLineIds {
    lines(transportModes: [rail]) {
      id
    }
  }
`;

const NETWORK_LINES_BY_IDS_QUERY = `
  query NetworkLinesByIds($ids: [ID]) {
    lines(ids: $ids) {
      presentation { colour }
      id
      publicCode
      name
      transportMode
      authority {
        name
      }
      journeyPatterns {
        id
        name
        pointsOnLink {
          points
        }
      }
      quays {
        stopPlace {
          id
          name
          latitude
          longitude
        }
      }
    }
  }
`;

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

interface RawNetworkLine {
  presentation?: LinePresentation | null;
  id: string;
  publicCode?: string | null;
  name?: string | null;
  transportMode?: string | null;
  authority?: { name?: string | null } | null;
  journeyPatterns?: Array<{
    id?: string | null;
    name?: string | null;
    pointsOnLink?: { points?: string | null } | null;
  }> | null;
  quays?: Array<{
    stopPlace?: {
      id?: string | null;
      name?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    } | null;
  }> | null;
}

const networkDataCache = new Map<'metro' | 'train' | 'tram', NetworkData>();

function classifyRailCategory(lineCode: string): RailCategory {
  const code = lineCode.toUpperCase();
  if (code.startsWith('FLY')) return 'airport';
  if (code.startsWith('L')) return 'local';
  if (code.startsWith('F')) return 'long_distance';
  return 'regional';
}

/**
 * Replaces coarse station-to-station rail segments (e.g. Flytoget) with
 * matching curved track sub-polylines from detailed Vy regional rail routes.
 */
function refineCoarseRailRoutes(routes: NetworkRoute[]): void {
  const detailed = routes.filter(
    (r) => r.coordinates.length >= 100 && maxSegmentJumpKm(r.coordinates) < 6.0,
  );
  if (detailed.length === 0) return;

  for (const route of routes) {
    if (route.coordinates.length < 2 || maxSegmentJumpKm(route.coordinates) <= 6.0) {
      continue;
    }

    const refined: LngLat[] = [];
    for (let i = 0; i < route.coordinates.length - 1; i++) {
      const [lonA, latA] = route.coordinates[i];
      const [lonB, latB] = route.coordinates[i + 1];
      const segKm = approxDistKm(lonA, latA, lonB, latB);

      let spliced: LngLat[] | null = null;
      if (segKm > 4.0) {
        let bestSliceLen = Infinity;
        for (const donor of detailed) {
          const hitA = findNearestCoordIndex(donor.coordinates, lonA, latA);
          const hitB = findNearestCoordIndex(donor.coordinates, lonB, latB);
          if (hitA.distKm < 0.6 && hitB.distKm < 0.6 && hitA.idx !== hitB.idx) {
            const slice =
              hitA.idx < hitB.idx
                ? donor.coordinates.slice(hitA.idx, hitB.idx + 1)
                : donor.coordinates.slice(hitB.idx, hitA.idx + 1).reverse();
            if (slice.length < bestSliceLen) {
              bestSliceLen = slice.length;
              spliced = slice;
            }
          }
        }
      }

      if (spliced && spliced.length >= 2) {
        if (refined.length > 0) refined.pop();
        refined.push(...spliced);
      } else {
        if (refined.length === 0) refined.push([lonA, latA]);
        refined.push([lonB, latB]);
      }
    }

    if (refined.length > route.coordinates.length) {
      route.coordinates = refined;
    }
  }
}

function buildNetworkData(
  rawLines: RawNetworkLine[],
  mode: TransitMode,
  filterBbox?: BoundingBox,
): NetworkData {
  const stopMap = new Map<string, NetworkStop>();
  const routes: NetworkRoute[] = [];

  for (const line of rawLines) {
    const lineCode = line.publicCode || line.name || line.id;
    const lineName = line.name || lineCode;
    const lineMode = line.transportMode ? mapVehicleMode(line.transportMode) : mode;

    const lineStopsMap = new Map<string, NetworkStop>();
    for (const q of line.quays ?? []) {
      const sp = q.stopPlace;
      if (
        !sp?.id ||
        typeof sp.latitude !== 'number' ||
        typeof sp.longitude !== 'number'
      ) {
        continue;
      }
      if (filterBbox && !isWithinBbox(sp.latitude, sp.longitude, filterBbox)) {
        continue;
      }

      if (!lineStopsMap.has(sp.id)) {
        lineStopsMap.set(sp.id, {
          id: sp.id,
          name: sp.name ?? sp.id,
          lat: sp.latitude,
          lon: sp.longitude,
          mode: lineMode,
          lines: [lineCode],
        });
      }

      const existingGlobal = stopMap.get(sp.id);
      if (existingGlobal) {
        if (existingGlobal.lines && !existingGlobal.lines.includes(lineCode)) {
          existingGlobal.lines.push(lineCode);
        }
      } else {
        stopMap.set(sp.id, {
          id: sp.id,
          name: sp.name ?? sp.id,
          lat: sp.latitude,
          lon: sp.longitude,
          mode: lineMode,
          lines: [lineCode],
        });
      }
    }

    const operatorName =
      line.authority?.name ?? (lineMode === 'train' ? undefined : 'Ruter');
    const lineStops = Array.from(lineStopsMap.values());

    if (lineMode === 'metro') {
      const allPatterns = [...(line.journeyPatterns ?? [])]
        .filter((jp) => (jp.pointsOnLink?.points?.length ?? 0) > 0)
        .sort(
          (a, b) =>
            (b.pointsOnLink?.points?.length ?? 0) -
            (a.pointsOnLink?.points?.length ?? 0),
        );

      // Exclude rare depot/positioning patterns (e.g. Line 2 -> Mortensrud/Ryen) by keeping
      // patterns whose endpoints match the line's official "TermA - TermB" name when available.
      const termini = line.name?.split(' - ').map((s) => s.trim()) ?? [];
      const primaryNames =
        termini.length === 2
          ? new Set([`${termini[0]}-${termini[1]}`, `${termini[1]}-${termini[0]}`])
          : null;
      const primaryPatterns = primaryNames
        ? allPatterns.filter((jp) => jp.name && primaryNames.has(jp.name.trim()))
        : [];
      const patterns = primaryPatterns.length > 0 ? primaryPatterns : allPatterns;

      const acceptedBranches: LngLat[][] = [];
      for (const jp of patterns) {
        const decoded = decodePolyline(jp.pointsOnLink?.points ?? '');
        const coords = filterBbox
          ? decoded.filter(([lon, lat]) => isWithinBbox(lat, lon, filterBbox))
          : decoded;

        const novelSegments = extractUncoveredSegments(coords, acceptedBranches);
        for (let sIdx = 0; sIdx < novelSegments.length; sIdx++) {
          const seg = novelSegments[sIdx];
          acceptedBranches.push(seg);

          routes.push({
            id: jp.id
              ? `${line.id}:${jp.id}:${sIdx}`
              : `${line.id}:${acceptedBranches.length}`,
            lineCode,
            lineName: jp.name ? `${lineCode} ${jp.name}` : lineName,
            mode: lineMode,
            operator: operatorName,
            operatorName,
            coordinates: seg,
            stops: lineStops,
          });
        }
      }
      continue;
    }

    let bestEncoded = '';
    for (const jp of line.journeyPatterns ?? []) {
      const pts = jp.pointsOnLink?.points ?? '';
      if (pts.length > bestEncoded.length) bestEncoded = pts;
    }

    let coordinates: LngLat[] = [];
    if (bestEncoded) {
      const decoded = decodePolyline(bestEncoded);
      coordinates = filterBbox
        ? decoded.filter(([lon, lat]) => isWithinBbox(lat, lon, filterBbox))
        : decoded;
    }

    routes.push({
      id: line.id,
      lineCode,
      lineColor: readLineColor(line.presentation),
      lineName,
      mode: lineMode,
      operator: operatorName,
      operatorName,
      railCategory: lineMode === 'train' ? classifyRailCategory(lineCode) : undefined,
      coordinates,
      stops: lineStops,
    });
  }

  if (mode === 'train') {
    refineCoarseRailRoutes(routes);
  }

  return {
    routes,
    stops: Array.from(stopMap.values()),
  };
}

/**
 * Fetches static route polylines and every stop for Oslo's Metro (T-bane), Tram, or
 * Norway's Train network. Cached in memory per mode.
 */
export async function fetchNetworkData(
  mode: 'metro' | 'train' | 'tram',
  signal?: AbortSignal,
): Promise<NetworkData> {
  const cached = networkDataCache.get(mode);
  if (cached) return cached;

  let rawLines: RawNetworkLine[] = [];

  if (mode === 'metro' || mode === 'tram') {
    const data = await postGraphQL<{ lines: RawNetworkLine[] }>(
      JOURNEY_PLANNER_ENDPOINT,
      NETWORK_LINES_BY_MODE_QUERY,
      { authorities: ['RUT:Authority:RUT'], modes: [mode] },
      signal,
    );
    rawLines = data.lines ?? [];
  } else {
    const discovery = await postGraphQL<{ lines: Array<{ id: string }> }>(
      JOURNEY_PLANNER_ENDPOINT,
      NORWAY_RAIL_LINES_QUERY,
      {},
      signal,
    );

    const lineIds = Array.from(
      new Set(
        (discovery.lines ?? [])
          .map((l) => l.id)
          .filter((id) => /^(VYG|FLT|SJN|GOA):/.test(id)),
      ),
    );

    const chunkResults = await postGraphQLBatched<{ lines: RawNetworkLine[] }>(
      JOURNEY_PLANNER_ENDPOINT,
      NETWORK_LINES_BY_IDS_QUERY,
      lineIds,
      { chunkSize: 3, concurrency: 4, signal },
    );

    rawLines = chunkResults.flatMap((r) => r.lines ?? []);
  }

  const result = buildNetworkData(
    rawLines,
    mode,
    mode === 'train' ? NORWAY_RAIL_BBOX : undefined,
  );
  networkDataCache.set(mode, result);
  return result;
}

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
      destination: call.destinationDisplay?.frontText ?? 'Unknown',
      aimedTime: call.aimedDepartureTime,
      expectedTime,
      delaySeconds,
      realtime: Boolean(call.realtime),
      platform: call.quay?.publicCode ?? null,
    };
  });
}

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

  const chunkResults = await postGraphQLBatched<{ lines: RawNetworkLine[] }>(
    JOURNEY_PLANNER_ENDPOINT,
    NETWORK_LINES_BY_IDS_QUERY,
    lineIds,
    { chunkSize: 6, concurrency: 4, signal },
  );

  const rawLines = chunkResults.flatMap((r) => r.lines ?? []);
  const { routes } = buildNetworkData(rawLines, mode ?? 'bus');

  return { departures, routes };
}
