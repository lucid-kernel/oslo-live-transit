import type {
  LiveVehicle,
  NetworkData,
  OsloHub,
  VehicleJourneyDetails,
} from '../../types/transit.ts';
import { getRouteColor, getVehicleColor, MODE_META } from '../transitTheme.ts';

export interface VehicleAnimState {
  lon: number;
  lat: number;
  bearing: number;
}

export interface PointFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: Record<string, string | number>;
}

export interface PointFeatureCollection {
  type: 'FeatureCollection';
  features: PointFeature[];
}

export interface LineFeature {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  properties: {
    id: string;
    lineCode: string;
    mode: string;
    color: string;
  };
}

export interface LineFeatureCollection {
  type: 'FeatureCollection';
  features: LineFeature[];
}

const EMPTY_POINTS: PointFeatureCollection = { type: 'FeatureCollection', features: [] };
const EMPTY_LINES: LineFeatureCollection = { type: 'FeatureCollection', features: [] };

/** Builds GeoJSON point features for live vehicles using their interpolated positions. */
export function buildVehicleFeatures(
  vehicles: Iterable<LiveVehicle>,
  positions: Map<string, VehicleAnimState>,
  nowMs = Date.now(),
  reducedMotion = false,
): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: Array.from(vehicles, (v) => {
      const pos = positions.get(v.id);
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [pos ? pos.lon : v.longitude, pos ? pos.lat : v.latitude],
        },
        properties: {
          id: v.id,
          ...(v.boardingSinceMs !== undefined && {
            boardingProgress: reducedMotion ? 1 : Math.min(1, Math.max(0, nowMs - v.boardingSinceMs) / 1400),
          }),
          lineCode: v.lineCode,
          color: getVehicleColor(v),
          bearing: pos ? pos.bearing : (v.bearing ?? 0),
          hasBearing: v.bearing !== null ? 1 : 0,
          mode: v.mode,
          positionSource: v.positionSource,
        },
      };
    }),
  };
}

/** Builds GeoJSON point features for major Oslo transit hubs. */
export function buildHubFeatures(hubs: OsloHub[]): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: hubs.map((hub) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [hub.longitude, hub.latitude],
      },
      properties: {
        id: hub.id,
        name: hub.name,
      },
    })),
  };
}

/** Builds GeoJSON line features for dedicated network routes (Metro, Train, Tram, or Bus stop routes). */
export function buildNetworkRouteFeatures(
  networkData: NetworkData | null,
): LineFeatureCollection {
  if (!networkData) return EMPTY_LINES;
  return {
    type: 'FeatureCollection',
    features: networkData.routes
      .filter((r) => r.coordinates.length >= 2)
      .map((r) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: r.coordinates,
        },
        properties: {
          id: r.id,
          lineCode: r.lineCode,
          mode: r.mode,
          color: getRouteColor(r),
        },
      })),
  };
}

/** Builds GeoJSON point features for clickable network stops. */
export function buildNetworkStopFeatures(
  networkData: NetworkData | null,
): PointFeatureCollection {
  if (!networkData) return EMPTY_POINTS;
  return {
    type: 'FeatureCollection',
    features: networkData.stops.map((s) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [s.lon, s.lat],
      },
      properties: {
        id: s.id,
        name: s.name,
        color: MODE_META[s.mode].color,
      },
    })),
  };
}

/** Builds a single-line GeoJSON collection for past or remaining vehicle journey paths. */
export function buildJourneyLineFeature(
  coordinates: [number, number][],
  color: string,
): LineFeatureCollection {
  if (coordinates.length < 2) return EMPTY_LINES;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates,
        },
        properties: {
          id: 'journey',
          lineCode: '',
          mode: '',
          color,
        },
      },
    ],
  };
}

/** Builds GeoJSON point features for past and upcoming stops on a selected vehicle journey. */
export function buildJourneyStopFeatures(
  journey: VehicleJourneyDetails | null,
  color: string,
): PointFeatureCollection {
  if (!journey) return EMPTY_POINTS;
  const allStops = [...journey.pastStops, ...journey.upcomingStops];
  return {
    type: 'FeatureCollection',
    features: allStops.map((s) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [s.lon, s.lat],
      },
      properties: {
        id: s.stopId,
        name: s.name,
        passed: s.passed ? 1 : 0,
        color: s.passed ? '#64748b' : color,
      },
    })),
  };
}
