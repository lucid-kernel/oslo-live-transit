import { locales, messages, number, type Language } from '../i18n/language.ts';
import type { LiveVehicle, NetworkRoute, RailCategory, TransitMode } from '../types/transit.ts';

export interface ModeMeta {
  mode: TransitMode;
  color: string;
}

export const MODE_META: Record<TransitMode, ModeMeta> = {
  bus: { mode: 'bus', color: '#E60000' },
  tram: { mode: 'tram', color: '#0B92E5' },
  train: { mode: 'train', color: '#10B981' },
  metro: { mode: 'metro', color: '#EC700C' },
  ferry: { mode: 'ferry', color: '#14B8A6' },
};

const DARK_TEXT_BADGE_OVERRIDES: Record<string, string> = {
  '#E60000': '#C8102E',
  '#EF4444': '#C8102E',
  '#8B5CF6': '#6D28D9',
  '#A855F7': '#7E22CE',
};

function hexRelativeLuminance(hex: string): number | null {
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Returns WCAG AA-compliant badge background and foreground colors for any transit line color. */
export function getBadgeStyle(rawColor: string): { backgroundColor: string; color: string } {
  const normalized = rawColor.trim().toUpperCase();
  const backgroundColor = DARK_TEXT_BADGE_OVERRIDES[normalized] ?? rawColor;
  const luminance = hexRelativeLuminance(backgroundColor);
  if (luminance !== null && luminance > 0.175) {
    return { backgroundColor, color: '#070A10' };
  }
  return { backgroundColor, color: '#FFFFFF' };
}

export const MODE_ORDER: TransitMode[] = ['bus', 'tram', 'train', 'metro', 'ferry'];

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

/** Returns Oslo-authentic color for a network route. */
export function getRouteColor({
  mode, lineCode, lineColor, operator, operatorName, railCategory,
}: Pick<NetworkRoute, 'mode' | 'lineCode' | 'lineColor' | 'operator' | 'operatorName' | 'railCategory'>): string {
  if (mode === 'bus' && lineColor) return lineColor;
  if (mode === 'metro' && TBANE_LINE_COLORS[lineCode]) {
    return TBANE_LINE_COLORS[lineCode];
  }
  if (mode === 'train') {
    if (railCategory && RAIL_CATEGORY_COLORS[railCategory]) {
      return RAIL_CATEGORY_COLORS[railCategory];
    }
    if (lineCode.startsWith('FLY') || (operatorName ?? operator)?.toLowerCase().includes('flytoget')) {
      return '#F97316';
    }
  }
  return MODE_META[mode].color;
}

/** Returns Oslo-authentic color, distinguishing T-bane lines 1–5 and Flytoget orange. */
export function getVehicleColor(
  vehicle: Pick<LiveVehicle, 'mode' | 'lineCode' | 'lineColor' | 'codespace' | 'operator'>,
): string {
  if (vehicle.mode === 'train' && vehicle.codespace === 'FLT') return '#F97316';
  return getRouteColor(vehicle);
}

const speedOptions = { style: 'unit', unit: 'kilometer-per-hour', maximumFractionDigits: 0 } as const;
const speedFormats = {
  nb: new Intl.NumberFormat(locales.nb, speedOptions),
  en: new Intl.NumberFormat(locales.en, speedOptions),
};

export function formatSpeedKmh(speedMps: number | null, language: Language): string {
  if (speedMps === null || Number.isNaN(speedMps)) return '—';
  return speedFormats[language].format(speedMps * 3.6);
}

export function formatDelay(delaySeconds: number | null, language: Language): {
  text: string;
  tone: 'on-time' | 'delayed' | 'late' | 'neutral';
} {
  if (delaySeconds === null || Number.isNaN(delaySeconds)) {
    return { text: '—', tone: 'neutral' };
  }
  if (Math.abs(delaySeconds) < 45) {
    return { text: messages[language].onTime, tone: 'on-time' };
  }
  const absMin = Math.round(Math.abs(delaySeconds) / 60);
  if (delaySeconds > 0) {
    return {
      text: messages[language].late(number(absMin, language)),
      tone: absMin >= 5 ? 'late' : 'delayed',
    };
  }
  return { text: messages[language].early(number(absMin, language)), tone: 'on-time' };
}

export function formatCompassBearing(bearing: number | null, language: Language): string {
  if (bearing === null || Number.isNaN(bearing)) return '—';
  const dirs = language === 'nb' ? ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'] : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const normalized = ((bearing % 360) + 360) % 360;
  const idx = Math.round(normalized / 45) % 8;
  return `${Math.round(normalized)}° ${dirs[idx]}`;
}

function osloClock(locale: string, seconds: boolean) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Oslo', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
    ...(seconds && { second: '2-digit' }),
  });
}

const clocks = {
  en: { full: osloClock(locales.en, true), short: osloClock(locales.en, false) },
  nb: { full: osloClock(locales.nb, true), short: osloClock(locales.nb, false) },
};

export function formatOsloTime(timestamp: string | number, language: Language, precision: 'full' | 'short' = 'full'): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '—' : clocks[language][precision].format(date);
}

/** Returns a short relative countdown (e.g. "Now", "3m") for departures within 60 minutes. */
export function formatDepartureCountdown(isoTimestamp: string, language: Language): string | null {
  const targetMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(targetMs)) return null;
  const diffMin = Math.round((targetMs - Date.now()) / 60_000);
  if (diffMin <= 0) return messages[language].now;
  if (diffMin < 60) return messages[language].minutes(number(diffMin, language));
  return null;
}
