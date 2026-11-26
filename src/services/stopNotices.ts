import { locales, messages, type Language } from '../i18n/language.ts';
import type { DisruptedStop, OsloHub, TransitMode } from '../types/transit.ts';
import { JOURNEY_PLANNER_ENDPOINT, postGraphQL } from './enturClient.ts';

interface Message { language: string; value: string }
interface NoticePlace extends OsloHub { transportMode: string[] | null }
interface NoticeLine { publicCode: string | null; transportMode: string | null }

const feedModes: Record<TransitMode, readonly string[]> = {
  bus: ['bus', 'coach'], tram: ['tram'], metro: ['metro'], train: ['rail'], ferry: ['water', 'ferry'],
};

interface Situation {
  id: string;
  summary: Message[];
  description: Message[];
  advice: Message[];
  validityPeriods: { startTime: string | null; endTime: string | null }[];
  affects: {
    __typename: string;
    stopPlace?: NoticePlace | null;
    quay?: { stopPlace?: NoticePlace | null } | null;
    line?: NoticeLine | null;
    serviceJourney?: { line: NoticeLine | null } | null;
  }[];
}

const QUERY = `
  fragment NoticePlace on StopPlace { id name latitude longitude transportMode }
  query RuterStopNotices {
    situations(codespaces: ["RUT"]) {
      id summary { language value } description { language value } advice { language value }
      validityPeriods { startTime endTime }
      affects {
        __typename
        ... on AffectedStopPlace { stopPlace { ...NoticePlace } quay { stopPlace { ...NoticePlace } } }
        ... on AffectedStopPlaceOnLine { line { publicCode transportMode } stopPlace { ...NoticePlace } quay { stopPlace { ...NoticePlace } } }
        ... on AffectedStopPlaceOnServiceJourney { serviceJourney { line { publicCode transportMode } } stopPlace { ...NoticePlace } quay { stopPlace { ...NoticePlace } } }
      }
    }
  }`;

function messageText(variants: Message[], language: Language) {
  const available = variants.filter(item => item.value.trim());
  const base = (item: Message) => item.language?.toLowerCase().split('-')[0];
  const preferred = available.find(item => base(item) === language)
    ?? (language === 'nb' ? available.find(item => base(item) === 'no') : undefined);
  if (preferred) return preferred.value.trim();
  const original = available[0];
  if (!original) return '';
  const m = messages[language];
  let name = original.language || m.unknownLanguage;
  try {
    name = new Intl.DisplayNames(locales[language], { type: 'language' }).of(name) || name;
  } catch { /* A provider can send a non-standard language code. */ }
  return m.original(name, original.value.trim());
}

export async function fetchStopSituations(signal: AbortSignal): Promise<Situation[]> {
  const { situations } = await postGraphQL<{ situations: Situation[] }>(
    JOURNEY_PLANNER_ENDPOINT, QUERY, {}, signal,
  );
  return situations;
}

export function disruptedStopsForMode(situations: Situation[], selectedMode: TransitMode | 'all', language: Language): DisruptedStop[] {
  const stops = new Map<string, DisruptedStop>();
  const now = Date.now();
  for (const situation of situations) {
    const periods = situation.validityPeriods;
    if (periods.length && !periods.some(p =>
      (!p.startTime || Date.parse(p.startTime) <= now) && (!p.endTime || now < Date.parse(p.endTime)),
    )) continue;
    const summary = messageText(situation.summary, language) || messages[language].notice;
    const detail = [...new Set([messageText(situation.description, language), messageText(situation.advice, language)])]
      .filter(text => text && text !== summary).join(' ');

    for (const affect of situation.affects) {
      const place = affect.stopPlace ?? affect.quay?.stopPlace;
      if (!place) continue;
      const line = affect.line ?? affect.serviceJourney?.line;
      const mode = affect.__typename === 'AffectedStopPlace' && place.transportMode?.length === 1
        ? place.transportMode[0] : line?.transportMode;
      if (selectedMode !== 'all' && (!mode || !feedModes[selectedMode].includes(mode))) continue;

      const stop: DisruptedStop = stops.get(place.id) ?? { ...place, notices: [] };
      const code = line?.publicCode;
      const existing = stop.notices.find(n => n.id === situation.id);
      if (existing) {
        if (code && !existing.lines.includes(code)) existing.lines.push(code);
      } else {
        stop.notices.push({ id: situation.id, summary, detail, lines: code ? [code] : [] });
      }
      stops.set(place.id, stop);
    }
  }
  return [...stops.values()];
}
