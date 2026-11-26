import { en } from './en.ts';
import { nb } from './nb.ts';

export type Language = 'nb' | 'en';
export const locales = { nb: 'nb-NO', en: 'en-GB' } as const;

// Check keys and function signatures in both directions, including interpolated arguments.
type SameCatalog<A, B> = [A, B] extends [B, A] ? A : never;
export const messages: Record<Language, SameCatalog<typeof en, typeof nb>> = { en, nb };
export const preferenceKey = 'oslo-live-transit.language';

export function matchLanguage(tag: string): Language | undefined {
  const base = tag.toLowerCase().split('-')[0];
  if (base === 'en') return 'en';
  if (base === 'nb' || base === 'no' || base === 'nn') return 'nb';
}

export function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(preferenceKey);
    if (saved === 'nb' || saved === 'en') return saved;
  } catch { /* Browser storage may be disabled. */ }
  for (const tag of navigator.languages.length ? navigator.languages : [navigator.language]) {
    const supported = matchLanguage(tag);
    if (supported) return supported;
  }
  return 'en';
}

const numberFormats = {
  en: new Intl.NumberFormat(locales.en, { maximumFractionDigits: 1 }),
  nb: new Intl.NumberFormat(locales.nb, { maximumFractionDigits: 1 }),
};

export function number(value: number, language: Language): string {
  return numberFormats[language].format(value);
}

export function bikeAvailability(station: { bikes: number; docks: number }, language: Language) {
  const m = messages[language];
  return `${m.bikeCount(station.bikes)} · ${m.freeDocks(station.docks)}`;
}
