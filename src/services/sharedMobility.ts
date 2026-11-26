import type { AvailableScooter, BikeStation, BoundingBox, OsloHub } from '../types/transit.ts';
import { postGraphQL } from './enturClient.ts';

const BIKE_FEED = 'https://gbfs.urbansharing.com/oslobysykkel.no';

interface StationLocation {
  capacity?: number;
  station_id: string;
  name: string;
  lat: number;
  lon: number;
}

interface StationStatus {
  station_id: string;
  is_installed: boolean;
  is_renting: boolean;
  is_returning: boolean;
  num_bikes_available: number;
  num_docks_available: number;
}

async function stationFeed<T>(name: string, signal: AbortSignal): Promise<T[]> {
  const response = await fetch(`${BIKE_FEED}/${name}.json`, { signal });
  if (!response.ok) throw new Error(`Bike feed HTTP ${response.status}`);
  const json = await response.json();
  if (!Array.isArray(json.data?.stations)) throw new Error('Missing bike stations');
  return json.data.stations;
}

let locations: { fetched: number; rows: StationLocation[] } | undefined;

async function stationLocations(signal: AbortSignal) {
  if (locations && Date.now() - locations.fetched < 15 * 60_000) return locations.rows;
  const rows = await stationFeed<StationLocation>('station_information', signal);
  locations = { fetched: Date.now(), rows };
  return rows;
}

export async function fetchBikeStations(signal: AbortSignal): Promise<BikeStation[]> {
  const [stations, statuses] = await Promise.all([
    stationLocations(signal), stationFeed<StationStatus>('station_status', signal),
  ]);
  const byId = new Map(statuses.map(status => [status.station_id, status]));
  return stations.flatMap(station => {
    const status = byId.get(station.station_id);
    if (!status?.is_installed || (!status.is_renting && !status.is_returning)) return [];
    return [{
      id: station.station_id, name: station.name, lat: station.lat, lon: station.lon,
      capacity: station.capacity,
      bikes: status.is_renting ? status.num_bikes_available : 0,
      docks: status.is_returning ? status.num_docks_available : 0,
    }];
  });
}

export function bikeAvailability(station: BikeStation): string {
  const bikes = station.bikes === 1 ? '1 bike' : `${station.bikes} bikes`;
  const docks = station.docks === 1 ? '1 free dock' : `${station.docks} free docks`;
  return `${bikes} · ${docks}`;
}

const OPERATORS: Record<string, string> = { voioslo: 'Voi', boltoslo: 'Bolt', rydeoslo: 'Ryde' };
const MOBILITY_ENDPOINT = 'https://api.entur.io/mobility/v2/graphql';
const AVAILABLE_FILTERS = `systems: ["voioslo","boltoslo","rydeoslo"],
  formFactors: [SCOOTER_STANDING,SCOOTER_SEATED], includeDisabled: false, includeReserved: false`;
export const SCOOTER_OPERATORS = Object.values(OPERATORS);
export const SCOOTER_OVERVIEW: BoundingBox = { minLat: 59.80, maxLat: 60.03, minLon: 10.47, maxLon: 11.03 };
export const SCOOTER_MIN_ZOOM = 15;
export const NEARBY_METRES = 500;

export async function fetchScooters(area: BoundingBox | OsloHub, signal: AbortSignal): Promise<AvailableScooter[]> {
  const data = await postGraphQL<{
    vehicles: { id: string; lat: number; lon: number; system: { id: string } }[];
  }>(MOBILITY_ENDPOINT, `
    query AvailableScooters($minLat: Float, $maxLat: Float, $minLon: Float, $maxLon: Float,
      $lat: Float, $lon: Float, $range: Int) {
      vehicles(minimumLatitude: $minLat, maximumLatitude: $maxLat, minimumLongitude: $minLon,
        maximumLongitude: $maxLon, lat: $lat, lon: $lon, range: $range,
        ${AVAILABLE_FILTERS}) { id lat lon system { id } }
    }`, 'latitude' in area ? { lat: area.latitude, lon: area.longitude, range: NEARBY_METRES } : { ...area }, signal);
  return data.vehicles.map(vehicle => ({
    id: vehicle.id, lat: vehicle.lat, lon: vehicle.lon, operator: OPERATORS[vehicle.system.id],
  }));
}

interface RentalUris { ios?: string; android?: string; web?: string }

export interface ScooterDetails {
  currentFuelPercent: number | null;
  currentRangeMeters: number | null;
  rentalUris: RentalUris | null;
}

export async function fetchScooterDetails(id: string, signal: AbortSignal) {
  const { vehicles } = await postGraphQL<{ vehicles: ScooterDetails[] }>(MOBILITY_ENDPOINT, `
    query ScooterDetails($ids: [String!]) {
      vehicles(ids: $ids, ${AVAILABLE_FILTERS}) { currentFuelPercent currentRangeMeters rentalUris { ios android web } }
    }`, { ids: [id] }, signal);
  return vehicles[0] ?? null;
}

export function scooterRentalLink(operator: string, links: RentalUris | null) {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mobileLink = ios ? links?.ios : /Android/i.test(navigator.userAgent) ? links?.android : null;
  for (const link of [mobileLink, links?.web]) {
    if (!link) continue;
    try {
      const url = new URL(link);
      if (url.protocol === 'https:' || (link === mobileLink && operator === 'Bolt' && url.protocol === 'bolt:')) return url.href;
    } catch { /* Try the web fallback for malformed operator links. */ }
  }
  return null;
}
