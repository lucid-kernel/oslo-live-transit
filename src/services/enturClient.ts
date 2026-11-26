import type { TransitMode } from '../types/transit.ts';

export const VEHICLES_ENDPOINT = 'https://api.entur.io/realtime/v2/vehicles/graphql';
export const JOURNEY_PLANNER_ENDPOINT = 'https://api.entur.io/journey-planner/v3/graphql';
export const CLIENT_NAME = 'oslo-live-transit-showcase';

export const CODESPACE_OPERATOR_NAMES: Record<string, string> = {
  RUT: 'Ruter',
  VYG: 'Vy',
  VYX: 'Vy Buss',
  VYB: 'Vy Buss',
  FLT: 'Flytoget',
  BRA: 'Brakar',
  NBU: 'Unibuss',
  FLI: 'FlixBus',
  INN: 'Innlandstrafikk',
  OST: 'Østfold Kollektivtrafikk',
  GOA: 'Go-Ahead Nordic',
  SJN: 'SJ Norge',
  NOR: 'NOR-WAY Bussekspress',
};

export interface LinePresentation {
  colour?: string | null;
}

export function readLineColor(presentation?: LinePresentation | null): string | undefined {
  const hex = presentation?.colour?.trim().replace(/^#/, '');
  return hex && /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : undefined;
}

/** Maps Entur SIRI/NeTEx transport mode strings to normalized `TransitMode`. */
export function mapVehicleMode(rawMode: string | null | undefined): TransitMode {
  switch (rawMode?.toUpperCase()) {
    case 'TRAM':
      return 'tram';
    case 'RAIL':
      return 'train';
    case 'METRO':
      return 'metro';
    case 'FERRY':
    case 'WATER':
      return 'ferry';
    case 'BUS':
    case 'COACH':
    default:
      return 'bus';
  }
}

/** Executes a single GraphQL POST request against an Entur endpoint. */
export async function postGraphQL<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ET-Client-Name': CLIENT_NAME,
    },
    body: JSON.stringify({ query, variables }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Entur API HTTP ${response.status}: ${response.statusText}`);
  }

  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(`Entur GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`);
  }

  if (!json.data) {
    throw new Error('Entur API returned empty data');
  }

  return json.data;
}

/**
 * Splits `ids` into chunks of `chunkSize` and executes GraphQL queries with
 * bounded `concurrency` to stay under Entur Apigee's response buffer and rate limits.
 */
export async function postGraphQLBatched<T>(
  endpoint: string,
  query: string,
  ids: string[],
  options?: { chunkSize?: number; concurrency?: number; signal?: AbortSignal },
): Promise<T[]> {
  if (ids.length === 0) return [];

  const chunkSize = options?.chunkSize ?? 6;
  const concurrency = options?.concurrency ?? 4;
  const chunks: string[][] = [];

  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }

  const results: T[] = [];
  for (let i = 0; i < chunks.length; i += concurrency) {
    const wave = chunks.slice(i, i + concurrency);
    const waveResults = await Promise.all(
      wave.map((chunkIds) =>
        postGraphQL<T>(endpoint, query, { ids: chunkIds }, options?.signal),
      ),
    );
    results.push(...waveResults);
  }

  return results;
}
