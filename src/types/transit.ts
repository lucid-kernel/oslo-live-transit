export type TransitMode = 'bus' | 'tram' | 'train' | 'metro' | 'ferry';

export type PositionSource = 'gps' | 'estimated';

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface LiveVehicle {
  id: string;
  mode: TransitMode;
  positionSource: PositionSource;
  serviceJourneyId?: string;
  lineRef: string;
  lineCode: string;
  lineColor?: string;
  lineName: string;
  destination: string;
  origin: string | null;
  currentStopName?: string | null;
  nextStopName?: string | null;
  operator: string;
  codespace: string;
  latitude: number;
  longitude: number;
  bearing: number | null;
  /** Speed in meters per second when reported by the vehicle feed. */
  speed: number | null;
  /** Delay in seconds (positive = late, negative = early). */
  delaySeconds: number | null;
  monitored: boolean;
  inCongestion: boolean;
  occupancyStatus: string | null;
  lastUpdated: string;
}

export interface VehicleStats {
  total: number;
  byMode: Record<TransitMode, number>;
  bySource: Record<PositionSource, number>;
  fetchedAt: string;
}

export interface LiveVehiclesResponse {
  vehicles: LiveVehicle[];
  stats: VehicleStats;
}

export interface StopDeparture {
  stopId: string;
  stopName: string;
  lineCode: string;
  lineColor?: string;
  lineName: string;
  mode: TransitMode;
  destination: string;
  aimedTime: string;
  expectedTime: string;
  delaySeconds: number;
  realtime: boolean;
  platform: string | null;
}

export interface OsloHub {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface NetworkStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  mode: TransitMode;
  lines?: string[];
}

export type RailCategory = 'local' | 'regional' | 'long_distance' | 'airport';

export interface NetworkRoute {
  id: string;
  lineCode: string;
  lineColor?: string;
  lineName: string;
  mode: TransitMode;
  operator?: string;
  operatorName?: string;
  railCategory?: RailCategory;
  /** `[longitude, latitude]` coordinate pairs ready for GeoJSON LineString. */
  coordinates: [number, number][];
  stops: NetworkStop[];
}

export interface NetworkData {
  routes: NetworkRoute[];
  stops: NetworkStop[];
}

export interface JourneyStopCall {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
  aimedTime: string | null;
  expectedTime: string | null;
  passed: boolean;
}

export interface VehicleJourneyDetails {
  vehicleId: string;
  lineCode: string;
  destination: string;
  /** `[longitude, latitude]` pairs from trip start up to the vehicle's current position. */
  pastCoordinates: [number, number][];
  /** `[longitude, latitude]` pairs from the vehicle's current position to the terminus. */
  remainingCoordinates: [number, number][];
  pastStops: JourneyStopCall[];
  upcomingStops: JourneyStopCall[];
  endStationName: string | null;
  endStationEta: string | null;
}
