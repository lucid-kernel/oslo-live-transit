import type {
  BoundingBox,
  LiveVehicle,
  LiveVehiclesResponse,
  OsloHub,
  PositionSource,
  TransitMode,
  VehicleStats,
} from '../types/transit.ts';
import {
  CODESPACE_OPERATOR_NAMES,
  VEHICLES_ENDPOINT,
  isFlybussen,
  readLineColor,
  type LinePresentation,
  mapVehicleMode,
  postGraphQL,
} from './enturClient.ts';
import {
  ensureRuterJourneysFresh,
  interpolateEstimatedVehicles,
} from './ruterEstimated.ts';

export { interpolateEstimatedVehicles } from './ruterEstimated.ts';
export {
  fetchNetworkData,
  fetchStopDepartures,
  fetchStopsInBounds,
  fetchStopWithRoutes,
  fetchVehicleJourney,
} from './networkRoutes.ts';

export const OSLO_CENTER = {
  latitude: 59.9139,
  longitude: 10.7522,
} as const;

export const OSLO_BOUNDING_BOX: BoundingBox = {
  minLat: 59.75,
  maxLat: 60.08,
  minLon: 10.4,
  maxLon: 11.1,
};

export const OSLO_HUBS: OsloHub[] = [
  { id: 'NSR:StopPlace:59872', name: 'Oslo S', latitude: 59.9111, longitude: 10.7536 },
  { id: 'NSR:StopPlace:58366', name: 'Jernbanetorget', latitude: 59.9122, longitude: 10.7506 },
  { id: 'NSR:StopPlace:58404', name: 'Nationaltheatret', latitude: 59.9148, longitude: 10.7332 },
  { id: 'NSR:StopPlace:58381', name: 'Majorstuen', latitude: 59.9299, longitude: 10.7151 },
  { id: 'NSR:StopPlace:58382', name: 'Aker brygge', latitude: 59.9095, longitude: 10.7277 },
];

const VEHICLE_FIELDS = `
  vehicleId
  mode
  serviceJourney {
    id
  }
  line {
    presentation { colour }
    lineRef
    lineName
    publicCode
  }
  operator {
    operatorRef
    name
  }
  codespace {
    codespaceId
  }
  destinationName
  originName
  location {
    latitude
    longitude
  }
  bearing
  speed
  delay
  monitored
  inCongestion
  occupancyStatus
  lastUpdated
`;

const VEHICLES_QUERY = `
  query OsloLiveVehicles($boundingBox: BoundingBox!) {
    vehicles(boundingBox: $boundingBox) {
      ${VEHICLE_FIELDS}
    }
  }
`;

const VEHICLES_BY_MODE_QUERY = `
  query NationalVehiclesByMode($mode: VehicleModeEnumeration!) {
    vehicles(mode: $mode) {
      ${VEHICLE_FIELDS}
    }
  }
`;

interface RawVehicle {
  vehicleId: string;
  mode: string | null;
  serviceJourney?: { id?: string | null } | null;
  line: {
    presentation?: LinePresentation | null;
    lineRef?: string | null;
    lineName?: string | null;
    publicCode?: string | null;
  } | null;
  operator: {
    operatorRef?: string | null;
    name?: string | null;
  } | null;
  codespace: {
    codespaceId?: string | null;
  } | null;
  destinationName?: string | null;
  originName?: string | null;
  location: {
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  bearing?: number | null;
  speed?: number | null;
  delay?: number | null;
  monitored?: boolean | null;
  inCongestion?: boolean | null;
  occupancyStatus?: string | null;
  lastUpdated?: string | null;
}

function extractLineCode(line: RawVehicle['line']): string {
  if (line?.publicCode) return line.publicCode;
  if (line?.lineRef) {
    const parts = line.lineRef.split(':');
    return parts[parts.length - 1] || line.lineRef;
  }
  return line?.lineName ?? '?';
}

function resolveOperatorName(raw: RawVehicle): string {
  if (raw.operator?.name) return raw.operator.name;
  const cs = raw.codespace?.codespaceId ?? '';
  if (cs && CODESPACE_OPERATOR_NAMES[cs]) {
    return CODESPACE_OPERATOR_NAMES[cs];
  }
  return cs || 'Unknown operator';
}

/** Computes aggregate counts by transit mode and position source. */
export function computeVehicleStats(
  vehicles: LiveVehicle[],
  fetchedAt: string = new Date().toISOString(),
): VehicleStats {
  const byMode: Record<TransitMode, number> = {
    bus: 0,
    tram: 0,
    train: 0,
    metro: 0,
    ferry: 0,
  };
  const bySource: Record<PositionSource, number> = {
    gps: 0,
    estimated: 0,
  };

  for (const v of vehicles) {
    byMode[v.mode] += 1;
    bySource[v.positionSource] += 1;
  }

  return {
    total: vehicles.length,
    byMode,
    bySource,
    fetchedAt,
  };
}

async function fetchGpsVehicles(
  options: { boundingBox?: BoundingBox; mode?: 'RAIL' },
  signal?: AbortSignal,
): Promise<LiveVehicle[]> {
  const data = options.mode
    ? await postGraphQL<{ vehicles: RawVehicle[] }>(
        VEHICLES_ENDPOINT,
        VEHICLES_BY_MODE_QUERY,
        { mode: options.mode },
        signal,
      )
    : await postGraphQL<{ vehicles: RawVehicle[] }>(
        VEHICLES_ENDPOINT,
        VEHICLES_QUERY,
        { boundingBox: options.boundingBox ?? OSLO_BOUNDING_BOX },
        signal,
      );

  const fetchedAt = new Date().toISOString();
  const vehicles: LiveVehicle[] = [];

  for (const raw of data.vehicles ?? []) {
    const lat = raw.location?.latitude;
    const lon = raw.location?.longitude;
    if (
      typeof lat !== 'number' ||
      typeof lon !== 'number' ||
      Number.isNaN(lat) ||
      Number.isNaN(lon)
    ) {
      continue;
    }

    const lineCode = extractLineCode(raw.line);
    if (isFlybussen({
      transportMode: raw.mode,
      publicCode: lineCode,
      name: raw.line?.lineName,
      authority: raw.operator,
    })) continue;
    vehicles.push({
      id: raw.vehicleId,
      mode: mapVehicleMode(raw.mode),
      positionSource: 'gps',
      serviceJourneyId: raw.serviceJourney?.id ?? undefined,
      lineRef: raw.line?.lineRef ?? '',
      lineCode,
      lineColor: readLineColor(raw.line?.presentation),
      lineName: raw.line?.lineName ?? lineCode,
      destination: raw.destinationName || 'In service',
      origin: raw.originName ?? null,
      operator: resolveOperatorName(raw),
      codespace: raw.codespace?.codespaceId ?? '',
      latitude: lat,
      longitude: lon,
      bearing:
        typeof raw.bearing === 'number' && !Number.isNaN(raw.bearing)
          ? raw.bearing
          : null,
      speed:
        typeof raw.speed === 'number' && !Number.isNaN(raw.speed) ? raw.speed : null,
      delaySeconds:
        typeof raw.delay === 'number' && !Number.isNaN(raw.delay) ? raw.delay : null,
      monitored: Boolean(raw.monitored),
      inCongestion: Boolean(raw.inCongestion),
      occupancyStatus: raw.occupancyStatus ?? null,
      lastUpdated: raw.lastUpdated ?? fetchedAt,
    });
  }

  return vehicles;
}

/** Fetches all live GPS trains across Norway (`Vy`, `Flytoget`, `SJ Norge`, `Go-Ahead`). */
export async function fetchNationalTrains(
  signal?: AbortSignal,
): Promise<LiveVehiclesResponse> {
  const vehicles = await fetchGpsVehicles({ mode: 'RAIL' }, signal);
  return {
    vehicles,
    stats: computeVehicleStats(vehicles),
  };
}

/**
 * Fetches live vehicles for either Greater Oslo (GPS + estimated Ruter vehicles)
 * or all of Norway's rail network (`scope: 'norway-rail'`).
 */
export async function fetchLiveVehicles(options?: {
  boundingBox?: BoundingBox;
  scope?: 'oslo' | 'norway-rail';
  signal?: AbortSignal;
}): Promise<LiveVehiclesResponse> {
  if (options?.scope === 'norway-rail') {
    return fetchNationalTrains(options.signal);
  }

  const boundingBox = options?.boundingBox ?? OSLO_BOUNDING_BOX;

  const [gpsVehicles] = await Promise.all([
    fetchGpsVehicles({ boundingBox }, options?.signal),
    ensureRuterJourneysFresh(boundingBox, options?.signal).catch((err) => {
      if (options?.signal?.aborted) throw err;
    }),
  ]);

  const estimatedVehicles = interpolateEstimatedVehicles();
  const vehicles = [...gpsVehicles, ...estimatedVehicles];

  return {
    vehicles,
    stats: computeVehicleStats(vehicles),
  };
}
