import type { BoundingBox, NetworkData } from '../types/transit.ts';
import { JOURNEY_PLANNER_ENDPOINT, postGraphQL, postGraphQLBatched } from './enturClient.ts';
import { buildNetworkData, type RawNetworkLine } from './networkGeometry.ts';

const NORWAY_RAIL_BBOX: BoundingBox = {
  minLat: 57.9,
  maxLat: 71.2,
  minLon: 4.0,
  maxLon: 31.5,
};

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

const networkDataCache = new Map<'metro' | 'train' | 'tram', NetworkData>();

export async function fetchNetworkLinesById(ids: string[], chunkSize: number, signal?: AbortSignal) {
  const chunks = await postGraphQLBatched<{ lines: RawNetworkLine[] }>(
    JOURNEY_PLANNER_ENDPOINT, NETWORK_LINES_BY_IDS_QUERY, ids, { chunkSize, concurrency: 4, signal },
  );
  return chunks.flatMap(chunk => chunk.lines ?? []);
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

    rawLines = await fetchNetworkLinesById(lineIds, 3, signal);
  }

  const result = buildNetworkData(
    rawLines,
    mode,
    mode === 'train' ? NORWAY_RAIL_BBOX : undefined,
  );
  networkDataCache.set(mode, result);
  return result;
}
