import type { LiveVehicle, RailCategory, TransitMode } from '../types/transit.ts';

export interface ModeMeta {
  mode: TransitMode;
  label: string;
  color: string;
}

export const MODE_META: Record<TransitMode, ModeMeta> = {
  bus: { mode: 'bus', label: 'Bus', color: '#EF4444' },
  tram: { mode: 'tram', label: 'Tram', color: '#38BDF8' },
  train: { mode: 'train', label: 'Train', color: '#10B981' },
  metro: { mode: 'metro', label: 'Metro', color: '#F97316' },
  ferry: { mode: 'ferry', label: 'Ferry', color: '#14B8A6' },
};

export const MODE_ORDER: TransitMode[] = ['bus', 'tram', 'train', 'metro', 'ferry'];

export interface CameraPreset {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export const OSLO_CAMERA_PRESETS: CameraPreset[] = [
  {
    id: 'overview',
    label: 'City Overview',
    latitude: 59.9139,
    longitude: 10.7522,
    zoom: 11.7,
    pitch: 15,
    bearing: 0,
  },
  {
    id: 'oslo-s',
    label: 'Oslo S',
    latitude: 59.9111,
    longitude: 10.7536,
    zoom: 14.3,
    pitch: 28,
    bearing: -10,
  },
  {
    id: 'nationaltheatret',
    label: 'Nationaltheatret',
    latitude: 59.9148,
    longitude: 10.7332,
    zoom: 14.3,
    pitch: 25,
    bearing: 0,
  },
  {
    id: 'majorstuen',
    label: 'Majorstuen',
    latitude: 59.9299,
    longitude: 10.7151,
    zoom: 14.2,
    pitch: 22,
    bearing: 0,
  },
  {
    id: 'grunerlokka',
    label: 'Grünerløkka',
    latitude: 59.9225,
    longitude: 10.7595,
    zoom: 14.2,
    pitch: 20,
    bearing: 0,
  },
  {
    id: 'norway',
    label: 'Norway',
    latitude: 62.6,
    longitude: 10.5,
    zoom: 4.8,
    pitch: 0,
    bearing: 0,
  },
];

const TBANE_LINE_COLORS: Record<string, string> = {
  '1': '#008ECC', // Frognerseteren – Bergkrystallen (Light Blue)
  '2': '#EC700C', // Østerås – Ellingsrudåsen (Orange)
  '3': '#8B5CF6', // Kolsås – Mortensrud (Purple)
  '4': '#2563EB', // Vestli – Bergkrystallen (Deep Blue)
  '5': '#10B981', // Sognsvann – Vestli / Ringen (Green)
};

const RAIL_CATEGORY_COLORS: Record<RailCategory, string> = {
  airport: '#F97316', // Flytoget orange
  long_distance: '#A855F7', // F-trains (Bergensbanen, Dovrebanen, Sørlandsbanen, Nordlandsbanen)
  regional: '#10B981', // Regional / RE / R
  local: '#22D3EE', // Local L1, L2
};

export const RAIL_CATEGORY_LABELS: Record<RailCategory, string> = {
  local: 'Local',
  regional: 'Regional',
  long_distance: 'Long Distance',
  airport: 'Airport',
};

/** Returns Oslo-authentic color for a network route. */
export function getRouteColor(
  mode: TransitMode,
  lineCode: string,
  operator?: string,
  railCategory?: RailCategory,
): string {
  if (mode === 'metro' && TBANE_LINE_COLORS[lineCode]) {
    return TBANE_LINE_COLORS[lineCode];
  }
  if (mode === 'train') {
    if (railCategory && RAIL_CATEGORY_COLORS[railCategory]) {
      return RAIL_CATEGORY_COLORS[railCategory];
    }
    if (lineCode.startsWith('FLY') || operator?.toLowerCase().includes('flytoget')) {
      return '#F97316';
    }
  }
  return MODE_META[mode].color;
}

/** Returns Oslo-authentic color, distinguishing T-bane lines 1–5 and Flytoget orange. */
export function getVehicleColor(
  vehicle: Pick<LiveVehicle, 'mode' | 'lineCode' | 'codespace' | 'operator'>,
): string {
  if (vehicle.mode === 'metro') {
    return getRouteColor('metro', vehicle.lineCode);
  }
  if (
    vehicle.mode === 'train' &&
    (vehicle.codespace === 'FLT' || vehicle.operator.toLowerCase().includes('flytoget'))
  ) {
    return '#F97316';
  }
  return MODE_META[vehicle.mode].color;
}

export function formatSpeedKmh(speedMps: number | null): string {
  if (speedMps === null || Number.isNaN(speedMps)) return '—';
  return `${Math.round(speedMps * 3.6)} km/h`;
}

export function formatDelay(delaySeconds: number | null): {
  text: string;
  tone: 'on-time' | 'delayed' | 'late' | 'neutral';
} {
  if (delaySeconds === null || Number.isNaN(delaySeconds)) {
    return { text: '—', tone: 'neutral' };
  }
  if (Math.abs(delaySeconds) < 45) {
    return { text: 'On time', tone: 'on-time' };
  }
  const absMin = Math.round(Math.abs(delaySeconds) / 60);
  if (delaySeconds > 0) {
    return {
      text: `+${absMin}m late`,
      tone: absMin >= 5 ? 'late' : 'delayed',
    };
  }
  return { text: `${absMin}m early`, tone: 'on-time' };
}

export function formatCompassBearing(bearing: number | null): string {
  if (bearing === null || Number.isNaN(bearing)) return '—';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const normalized = ((bearing % 360) + 360) % 360;
  const idx = Math.round(normalized / 45) % 8;
  return `${Math.round(normalized)}° ${dirs[idx]}`;
}

export function formatOsloTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('nb-NO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Oslo',
  });
}
