import type { BoundingBox, LiveVehicle, TransitMode } from '../types/transit.ts';
import {
  JOURNEY_PLANNER_ENDPOINT,
  readLineColor,
  type LinePresentation,
  mapVehicleMode,
  postGraphQL,
  postGraphQLBatched,
} from './enturClient.ts';
import {
  computeBearing,
  decodePolyline,
  interpolateAlongSegment,
  isWithinBbox,
  type LngLat,
} from './geo.ts';

const TARGET_DWELL_MS = 20_000;
const ESTIMATED_REFRESH_MS = 20_000;

const FALLBACK_RUTER_STOP_IDS = [
  'NSR:StopPlace:58366', // Jernbanetorget
  'NSR:StopPlace:58404', // Nationaltheatret
  'NSR:StopPlace:58381', // Majorstuen
  'NSR:StopPlace:58189', // Carl Berners plass
  'NSR:StopPlace:58195', // Storo
  'NSR:StopPlace:59516', // Helsfyr
  'NSR:StopPlace:58228', // Mortensrud
  'NSR:StopPlace:58194', // Økern
  'NSR:StopPlace:58287', // Skøyen
  'NSR:StopPlace:59636', // Holmlia stasjon
  'NSR:StopPlace:58216', // Grorud
  'NSR:StopPlace:58221', // Furuset
  'NSR:StopPlace:58248', // Ryen
  'NSR:StopPlace:58245', // Lambertseter
  'NSR:StopPlace:59604', // Tøyen
  'NSR:StopPlace:58406', // Sinsenkrysset
  'NSR:StopPlace:58353', // Bislett
  'NSR:StopPlace:59894', // Sagene
  'NSR:StopPlace:59520', // Røa
  'NSR:StopPlace:58382', // Aker brygge
  'NSR:StopPlace:58175', // Rådhusbrygge 3
  'NSR:StopPlace:59222', // Vippetangen ferjeterminal
];

const RUTER_ALL_MODES_PATTERNS_QUERY = `
  query RuterAllModePatterns {
    lines(authorities: ["RUT:Authority:RUT"], transportModes: [bus, tram, metro, water]) {
      id
      transportMode
      journeyPatterns {
        quays {
          stopPlace {
            id
            latitude
            longitude
          }
        }
      }
    }
  }
`;

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
    authority?: { id?: string | null } | null;
  } | null;
  journeyPattern?: {
    id?: string | null;
    pointsOnLink?: { points?: string | null } | null;
  } | null;
  estimatedCalls?: RawJourneyCall[] | null;
}

interface CachedCall {
  arrivalMs: number;
  departureMs: number;
  aimedMs: number;
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
let cachedRuterJourneys: CachedJourney[] = [];
let lastEstimatedFetchMs = 0;
let estimatedFetchPromise: Promise<void> | null = null;
let cachedDiscoveryStopIds: string[] | null = null;
let discoveryStopIdsPromise: Promise<string[]> | null = null;

/**
 * Computes a minimal covering set of near-terminus stops across all Ruter
 * `bus`, `tram`, `metro`, and `water` journey patterns in `bbox` so every active
 * trip stays in `estimatedCalls` nearly all the way to its final stop.
 */
async function getRuterDiscoveryStopIds(
  bbox: BoundingBox,
  signal?: AbortSignal,
): Promise<string[]> {
  if (cachedDiscoveryStopIds) return cachedDiscoveryStopIds;
  if (!discoveryStopIdsPromise) {
    discoveryStopIdsPromise = (async () => {
      try {
        const data = await postGraphQL<{
          lines: Array<{
            id: string;
            transportMode?: string | null;
            journeyPatterns?: Array<{
              quays?: Array<{
                stopPlace?: {
                  id?: string | null;
                  latitude?: number | null;
                  longitude?: number | null;
                } | null;
              }> | null;
            }> | null;
          }>;
        }>(JOURNEY_PLANNER_ENDPOINT, RUTER_ALL_MODES_PATTERNS_QUERY, {}, signal);

        const exactPenSet = new Set<string>();
        const lineHalfSets: Set<string>[] = [];
        const seenTermini = new Set<string>();

        for (const line of data.lines ?? []) {
          const isMetroOrTram =
            line.transportMode === 'metro' || line.transportMode === 'tram';

          for (const jp of line.journeyPatterns ?? []) {
            const validStopIds: string[] = [];
            for (const q of jp.quays ?? []) {
              const sp = q.stopPlace;
              if (
                sp?.id &&
                typeof sp.latitude === 'number' &&
                typeof sp.longitude === 'number' &&
                isWithinBbox(sp.latitude, sp.longitude, bbox)
              ) {
                validStopIds.push(sp.id);
              }
            }

            if (validStopIds.length < 2) continue;

            if (isMetroOrTram) {
              exactPenSet.add(validStopIds[validStopIds.length - 2]);
            } else {
              const termId = validStopIds[validStopIds.length - 1];
              const key = `${line.id}:${termId}`;
              if (seenTermini.has(key)) continue;
              seenTermini.add(key);

              // Last 3 non-terminus stops so greedy set-cover shares hubs where possible
              const nearTerm = validStopIds.slice(
                Math.max(0, validStopIds.length - 4),
                validStopIds.length - 1,
              );
              if (nearTerm.length > 0) {
                lineHalfSets.push(new Set(nearTerm));
              }
            }
          }
        }

        const uncovered = new Set<number>(lineHalfSets.map((_, i) => i));
        const stopToLines = new Map<string, number[]>();
        lineHalfSets.forEach((stops, idx) => {
          for (const s of stops) {
            const list = stopToLines.get(s);
            if (list) list.push(idx);
            else stopToLines.set(s, [idx]);
          }
        });

        const chosenSet = new Set<string>(exactPenSet);
        for (const s of chosenSet) {
          for (const idx of stopToLines.get(s) ?? []) {
            uncovered.delete(idx);
          }
        }

        while (uncovered.size > 0) {
          let bestStop: string | null = null;
          let bestHits = 0;
          for (const [stopId, lineIdxs] of stopToLines.entries()) {
            let hits = 0;
            for (const idx of lineIdxs) {
              if (uncovered.has(idx)) hits++;
            }
            if (hits > bestHits) {
              bestHits = hits;
              bestStop = stopId;
            }
          }
          if (!bestStop || bestHits === 0) break;
          chosenSet.add(bestStop);
          for (const idx of stopToLines.get(bestStop) ?? []) {
            uncovered.delete(idx);
          }
        }

        const chosen = Array.from(chosenSet);
        cachedDiscoveryStopIds = chosen.length > 0 ? chosen : FALLBACK_RUTER_STOP_IDS;
        return cachedDiscoveryStopIds;
      } catch (err) {
        if (signal?.aborted) throw err;
        return FALLBACK_RUTER_STOP_IDS;
      } finally {
        discoveryStopIdsPromise = null;
      }
    })();
  }
  return discoveryStopIdsPromise;
}

function parseServiceJourney(sj: RawServiceJourney, nowMs: number): CachedJourney | null {
  if (sj.line?.authority?.id !== 'RUT:Authority:RUT') return null;

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
      arrivalMs,
      departureMs,
      aimedMs: Number.isFinite(aimedMs) ? aimedMs : departureMs,
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
    const previousStop = cachedJourneyMap.get(sj.id)?.calls.find(
      (call) => call.arrivalMs <= nowMs && nowMs <= call.departureMs,
    );
    for (let i = 0; i < calls.length - 1; i++) {
      const call = calls[i];
      // Reserve travel time on short legs while keeping the live departure fixed.
      const gap = i === 0 ? Infinity : call.departureMs - calls[i - 1].departureMs;
      const dwell = Math.min(TARGET_DWELL_MS, Math.max(0, gap / 2));
      call.arrivalMs = Math.min(call.arrivalMs, call.departureMs - dwell);
      // A revised departure can extend a stop the marker has already reached.
      if (previousStop && previousStop.aimedMs === call.aimedMs &&
          previousStop.lat === call.lat && previousStop.lon === call.lon) {
        call.arrivalMs = Math.min(call.arrivalMs, previousStop.arrivalMs);
      }
    }
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
    calls[0].destination || calls[calls.length - 1].stopName || 'In service';

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

  cachedRuterJourneys = Array.from(cachedJourneyMap.values());
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
    cachedRuterJourneys.length > 0
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

/**
 * Interpolates live positions for active Ruter (`RUT`) buses, trams, metro, and ferries
 * from the cached JourneyPlanner v3 `estimatedCalls` + `pointsOnLink` polylines.
 */
export function interpolateEstimatedVehicles(nowMs: number = Date.now()): LiveVehicle[] {
  const nowIso = new Date(nowMs).toISOString();
  const vehicles: LiveVehicle[] = [];

  for (const journey of cachedRuterJourneys) {
    if (nowMs < journey.startMs || nowMs > journey.endMs) continue;

    const { calls } = journey;
    for (let i = 0; i < calls.length; i++) {
      const curr = calls[i];
      const next = calls[i + 1];

      if (nowMs >= curr.arrivalMs && nowMs <= (next ? curr.departureMs : journey.endMs)) {
        vehicles.push({
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
          nextStopName: next?.stopName ?? null,
          operator: 'Ruter',
          codespace: 'RUT',
          latitude: curr.lat,
          longitude: curr.lon,
          bearing: next
            ? computeBearing(curr.lat, curr.lon, next.lat, next.lon)
            : null,
          speed: 0,
          delaySeconds: Math.round((curr.departureMs - curr.aimedMs) / 1000),
          monitored: curr.realtime,
          inCongestion: false,
          occupancyStatus: null,
          lastUpdated: nowIso,
        });
        break;
      }

      if (next && nowMs > curr.departureMs && nowMs < next.arrivalMs) {
        const span = Math.max(1, next.arrivalMs - curr.departureMs);
        const fraction = (nowMs - curr.departureMs) / span;
        const pos = interpolateAlongSegment(
          curr.lat,
          curr.lon,
          next.lat,
          next.lon,
          fraction,
          journey.polyline,
        );

        vehicles.push({
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
          nextStopName: next.stopName || null,
          operator: 'Ruter',
          codespace: 'RUT',
          latitude: pos.lat,
          longitude: pos.lon,
          bearing: pos.bearing,
          speed: null,
          delaySeconds: Math.round((curr.departureMs - curr.aimedMs) / 1000),
          monitored: curr.realtime || next.realtime,
          inCongestion: false,
          occupancyStatus: null,
          lastUpdated: nowIso,
        });
        break;
      }
    }
  }

  return vehicles;
}
