import type { BoundingBox } from '../types/transit.ts';
import { JOURNEY_PLANNER_ENDPOINT, isFlybussen, postGraphQL } from './enturClient.ts';
import { isWithinBbox } from './geo.ts';

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
      publicCode
      name
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

let cachedDiscoveryStopIds: string[] | null = null;
let discoveryStopIdsPromise: Promise<string[]> | null = null;

/**
 * Computes a minimal covering set of near-terminus stops across all Ruter
 * `bus`, `tram`, `metro`, and `water` journey patterns in `bbox` so every active
 * trip stays in `estimatedCalls` nearly all the way to its final stop.
 */
export async function getRuterDiscoveryStopIds(
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
            publicCode?: string | null;
            name?: string | null;
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
          if (isFlybussen(line)) continue;
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
