import type { BoundingBox, LiveVehicle, TransitMode } from '../types/transit.ts';
import {
  JOURNEY_PLANNER_ENDPOINT,
  isFlybussen,
  readLineColor,
  type LinePresentation,
  mapVehicleMode,
  postGraphQLBatched,
} from './enturClient.ts';
import {
  computeBearing,
  decodePolyline,
  interpolateAlongSegment,
  type LngLat,
} from './geo.ts';

import { getRuterDiscoveryStopIds } from './ruterDiscovery.ts';

const TARGET_DWELL_MS = 20_000;
const ESTIMATED_REFRESH_MS = 20_000;

const RUTER_ACTIVE_JOURNEYS_QUERY = `
  query RuterActiveJourneys($ids: [String]!) {
    stopPlaces(ids: $ids) {
      id
      estimatedCalls(
        timeRange: 3600
        numberOfDepartures: 80
        numberOfDeparturesPerLineAndDestinationDisplay: 6
      ) {
        serviceJourney {
          id
          line {
            presentation { colour }
            id
            publicCode
            name
            transportMode
            authority {
              id
            }
          }
          journeyPattern {
            id
            pointsOnLink {
              points
            }
          }
          estimatedCalls {
            cancellation
            forBoarding
            timingPoint
            actualArrivalTime
            actualDepartureTime
            realtime
            aimedArrivalTime
            aimedDepartureTime
            expectedArrivalTime
            expectedDepartureTime
            destinationDisplay {
              frontText
            }
            quay {
              id
              name
              latitude
              longitude
            }
          }
        }
      }
    }
  }
`;

interface RawJourneyCall {
  cancellation?: boolean;
  forBoarding: boolean;
  timingPoint?: boolean;
  actualArrivalTime?: string | null;
  actualDepartureTime?: string | null;
  realtime: boolean;
  aimedArrivalTime?: string | null;
  aimedDepartureTime?: string | null;
  expectedArrivalTime?: string | null;
  expectedDepartureTime?: string | null;
  destinationDisplay?: { frontText?: string | null } | null;
  quay?: {
    id?: string | null;
    name?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
}

interface RawServiceJourney {
  id: string;
  line?: {
    presentation?: LinePresentation | null;
    id?: string | null;
    publicCode?: string | null;
    name?: string | null;
    transportMode?: string | null;
    authority?: { id?: string | null; name?: string | null } | null;
  } | null;
  journeyPattern?: {
    id?: string | null;
    pointsOnLink?: { points?: string | null } | null;
  } | null;
  estimatedCalls?: RawJourneyCall[] | null;
}

interface CachedCall {
  forBoarding: boolean;
  arrivalMs: number;
  departureMs: number;
  aimedMs: number;
  delaySeconds: number;
  realtime: boolean;
  stopName: string;
  destination: string;
  lat: number;
  lon: number;
}

interface CachedJourney {
  id: string;
  mode: TransitMode;
  lineRef: string;
  lineCode: string;
  lineColor?: string;
  lineName: string;
  origin: string | null;
  destination: string;
  polyline: LngLat[] | null;
  calls: CachedCall[];
  startMs: number;
  endMs: number;
}

const polylineCache = new Map<string, LngLat[]>();
const cachedJourneyMap = new Map<string, CachedJourney>();
let lastEstimatedFetchMs = 0;
let estimatedFetchPromise: Promise<void> | null = null;
function sameCall(a: CachedCall, b: CachedCall): boolean {
  return a.aimedMs === b.aimedMs && a.lat === b.lat && a.lon === b.lon;
}

/** Keep the active leg on its original clock when a poll changes its ETA. */
function preserveActiveMotion(calls: CachedCall[], previous: CachedJourney, nowMs: number): void {
  const index = previous.calls.findIndex((call) => nowMs <= call.departureMs);
  if (index < 0 || nowMs < previous.startMs) return;
  const oldStop = previous.calls[index];
  const newIndex = calls.findIndex((call) => sameCall(call, oldStop));
  if (newIndex < 0) return;
  const stop = calls[newIndex];

  if (nowMs >= oldStop.arrivalMs) {
    stop.arrivalMs = Math.min(stop.arrivalMs, oldStop.arrivalMs);
    // If a departure was reported late, start pulling away from the displayed stop.
    stop.departureMs = Math.max(stop.departureMs, nowMs);
    return;
  }

  const oldFrom = previous.calls[index - 1];
  const from = calls[newIndex - 1];
  if (!from || !oldFrom || !sameCall(from, oldFrom)) return;
  from.arrivalMs = oldFrom.arrivalMs;
  from.departureMs = oldFrom.departureMs;
  stop.arrivalMs = oldStop.arrivalMs;
  stop.departureMs = Math.max(stop.departureMs, stop.arrivalMs);
}

function parseServiceJourney(sj: RawServiceJourney, nowMs: number): CachedJourney | null {
  if (sj.line?.authority?.id !== 'RUT:Authority:RUT') return null;

  if (isFlybussen(sj.line)) return null;
  const mode = mapVehicleMode(sj.line?.transportMode);
  if (mode === 'train') return null; // Trains already have live GPS

  const modelDwell = mode === 'bus' || mode === 'metro';
  const calls: CachedCall[] = [];
  for (const c of sj.estimatedCalls ?? []) {
    if (modelDwell && (c.cancellation || c.timingPoint)) continue;
    const lat = c.quay?.latitude;
    const lon = c.quay?.longitude;
    const arrival = modelDwell ? c.actualArrivalTime ?? c.expectedArrivalTime : c.expectedArrivalTime;
    const departure = modelDwell ? c.actualDepartureTime ?? c.expectedDepartureTime : c.expectedDepartureTime;
    const arrStr = arrival ?? departure;
    const depStr = departure ?? arrival;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !arrStr || !depStr) {
      continue;
    }
    const arrivalMs = Date.parse(arrStr);
    const departureMs = Date.parse(depStr);
    if (!Number.isFinite(arrivalMs) || !Number.isFinite(departureMs)) continue;

    const aimedStr = c.aimedDepartureTime ?? c.aimedArrivalTime ?? depStr;
    const aimedMs = Date.parse(aimedStr);

    calls.push({
      forBoarding: c.forBoarding,
      arrivalMs,
      departureMs,
      aimedMs: Number.isFinite(aimedMs) ? aimedMs : departureMs,
      delaySeconds: Number.isFinite(aimedMs) ? Math.round((departureMs - aimedMs) / 1000) : 0,
      realtime: Boolean(c.realtime),
      stopName: c.quay?.name ?? '',
      destination: c.destinationDisplay?.frontText ?? '',
      lat,
      lon,
    });
  }

  if (calls.length < 2) return null;

  const first = calls[0];
  const last = calls[calls.length - 1];
  if (modelDwell) {
    for (let i = 0; i < calls.length - 1; i++) {
      const call = calls[i];
      // Reserve travel time on short legs while keeping the live departure fixed.
      const gap = i === 0 ? Infinity : call.departureMs - calls[i - 1].departureMs;
      const dwell = Math.min(TARGET_DWELL_MS, Math.max(0, gap / 2));
      call.arrivalMs = Math.min(call.arrivalMs, call.departureMs - dwell);
    }
    const previous = cachedJourneyMap.get(sj.id);
    if (previous) preserveActiveMotion(calls, previous, nowMs);
  }

  const patternId = sj.journeyPattern?.id ?? '';
  const encoded = sj.journeyPattern?.pointsOnLink?.points ?? '';
  let polyline: LngLat[] | null = null;
  if (patternId && polylineCache.has(patternId)) {
    polyline = polylineCache.get(patternId)!;
  } else if (encoded) {
    polyline = decodePolyline(encoded);
    if (patternId) polylineCache.set(patternId, polyline);
  }

  const lineCode = sj.line?.publicCode ?? sj.line?.name ?? '?';
  const destination =
    calls[0].destination || calls[calls.length - 1].stopName;

  return {
    id: sj.id,
    mode,
    lineRef: sj.line?.id ?? '',
    lineCode,
    lineColor: readLineColor(sj.line?.presentation),
    lineName: sj.line?.name ?? lineCode,
    origin: calls[0].stopName || null,
    destination,
    polyline,
    calls,
    startMs: modelDwell ? first.arrivalMs : first.departureMs,
    endMs: modelDwell ? Math.max(last.departureMs, last.arrivalMs + TARGET_DWELL_MS) : last.arrivalMs,
  };
}

async function refreshRuterJourneys(bbox: BoundingBox): Promise<void> {
  const stopIds = await getRuterDiscoveryStopIds(bbox);
  const chunkResults = await postGraphQLBatched<{
    stopPlaces: Array<{
      id: string;
      estimatedCalls: Array<{ serviceJourney: RawServiceJourney | null }>;
    }>;
  }>(JOURNEY_PLANNER_ENDPOINT, RUTER_ACTIVE_JOURNEYS_QUERY, stopIds, {
    chunkSize: 10,
    concurrency: 6,
  });

  const seen = new Set<string>();
  const nowMs = Date.now();

  for (const data of chunkResults) {
    for (const sp of data.stopPlaces ?? []) {
      for (const call of sp.estimatedCalls ?? []) {
        const sj = call.serviceJourney;
        if (!sj || seen.has(sj.id)) continue;
        seen.add(sj.id);

        const parsed = parseServiceJourney(sj, nowMs);
        if (parsed) cachedJourneyMap.set(parsed.id, parsed);
      }
    }
  }

  for (const [id, j] of cachedJourneyMap.entries()) {
    if (j.endMs < nowMs - 60_000) cachedJourneyMap.delete(id);
  }

  lastEstimatedFetchMs = nowMs;
}

/** Refreshes active Ruter journeys if the 20s cache has expired. */
export async function ensureRuterJourneysFresh(
  bbox: BoundingBox,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  if (
    Date.now() - lastEstimatedFetchMs < ESTIMATED_REFRESH_MS &&
    cachedJourneyMap.size > 0
  ) {
    return;
  }
  if (!estimatedFetchPromise) {
    // Do not bind a single caller's AbortSignal to the shared cache warm-up,
    // so React StrictMode double-mounts don't abort the in-flight discovery.
    estimatedFetchPromise = refreshRuterJourneys(bbox).finally(() => {
      estimatedFetchPromise = null;
    });
  }

  if (!signal) {
    await estimatedFetchPromise;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    estimatedFetchPromise!.then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/** Integrate a linear speed ramp at each end and cruise through the middle. */
function stopToStopProgress(elapsedMs: number, durationMs: number): number {
  const accelerationMs = Math.min(5_000, durationMs * 0.15);
  const brakingMs = Math.min(18_000, durationMs * 0.4);
  // Area under the speed curve, expressed as time at cruising speed.
  const travel = durationMs - (accelerationMs + brakingMs) / 2;
  if (elapsedMs < accelerationMs) return elapsedMs ** 2 / (2 * accelerationMs * travel);
  const remainingMs = durationMs - elapsedMs;
  if (remainingMs < brakingMs) return 1 - remainingMs ** 2 / (2 * brakingMs * travel);
  return (elapsedMs - accelerationMs / 2) / travel;
}

/**
 * Interpolates live positions for active Ruter (`RUT`) buses, trams, metro, and ferries
 * from the cached JourneyPlanner v3 `estimatedCalls` + `pointsOnLink` polylines.
 */
export function interpolateEstimatedVehicles(nowMs: number = Date.now()): LiveVehicle[] {
  const nowIso = new Date(nowMs).toISOString();
  const vehicles: LiveVehicle[] = [];
  for (const journey of cachedJourneyMap.values()) {
    const vehicle = interpolateJourney(journey, nowMs, nowIso);
    if (vehicle) vehicles.push(vehicle);
  }
  return vehicles;
}

export function estimateVehiclePosition(journeyId: string, nowMs: number, nowIso: string) {
  const journey = cachedJourneyMap.get(journeyId);
  return journey && interpolateJourney(journey, nowMs, nowIso);
}

function interpolateJourney(journey: CachedJourney, nowMs: number, nowIso: string): LiveVehicle | null {
  if (nowMs < journey.startMs || nowMs > journey.endMs) return null;

  const { calls } = journey;
  for (let i = 0; i < calls.length; i++) {
    const curr = calls[i];
    const next = calls[i + 1];
    const stopped = nowMs >= curr.arrivalMs && nowMs <= (next ? curr.departureMs : journey.endMs);
    const moving = next && nowMs > curr.departureMs && nowMs < next.arrivalMs;
    if (!stopped && !moving) continue;

    let motion: Pick<LiveVehicle, 'latitude' | 'longitude' | 'bearing' | 'speed' | 'monitored' | 'boardingSinceMs' | 'nextStopName'>;
    if (stopped) {
      motion = {
        latitude: curr.lat,
        longitude: curr.lon,
        bearing: next ? computeBearing(curr.lat, curr.lon, next.lat, next.lon) : null,
        speed: 0,
        boardingSinceMs: journey.mode === 'bus' && next && curr.forBoarding ? curr.arrivalMs : undefined,
        monitored: curr.realtime,
        nextStopName: next?.stopName ?? null,
      };
    } else {
      const span = Math.max(1, next.arrivalMs - curr.departureMs);
      const elapsed = nowMs - curr.departureMs;
      const easeAtStops = journey.mode === 'bus' || journey.mode === 'metro';
      const fraction = easeAtStops ? stopToStopProgress(elapsed, span) : elapsed / span;
      const position = interpolateAlongSegment(curr.lat, curr.lon, next.lat, next.lon, fraction, journey.polyline, easeAtStops);
      motion = {
        latitude: position.lat,
        longitude: position.lon,
        bearing: position.bearing,
        speed: null,
        monitored: curr.realtime || next.realtime,
        nextStopName: next.stopName || null,
      };
    }
    return {
      id: `est:${journey.id}`,
      mode: journey.mode,
      positionSource: 'estimated',
      serviceJourneyId: journey.id,
      lineRef: journey.lineRef,
      lineCode: journey.lineCode,
      lineColor: journey.lineColor,
      lineName: journey.lineName,
      destination: curr.destination || journey.destination,
      origin: journey.origin,
      currentStopName: curr.stopName || null,
      operator: 'Ruter',
      codespace: 'RUT',
      ...motion,
      delaySeconds: curr.delaySeconds,
      inCongestion: false,
      occupancyStatus: null,
      lastUpdated: nowIso,
    };
  }
  return null;
}
