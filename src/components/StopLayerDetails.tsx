import { bikeAvailability, number } from '../i18n/language.ts';
import { useLanguage } from '../i18n/LanguageProvider.tsx';
import type { LocalLayers } from '../hooks/useLocalLayers.ts';
import { NEARBY_METRES } from '../services/sharedMobility.ts';

export function StopLayerDetails({ layers }: { layers: LocalLayers }) {
  const { m, language } = useLanguage();
  const { enabled, bikes, notices, stopNotices, nearbyStations, nearbyScooters } = layers;
  return (
    <>
      {enabled.notices && (!notices || notices.failed || stopNotices.length > 0) && (
        <section aria-label={m.notices} className="stop-layer-details">
          <h3>{m.notices}</h3>
          {!notices ? <p>{m.checkNotices}</p> : notices.failed ? <p>{m.noticesRetry}</p> :
            stopNotices.map(n => (
              <details key={n.id} className="stop-notice">
                <summary>{n.lines.length > 0 && <strong>{n.lines.length === 1 ? m.line : m.lines} {n.lines.join(', ')} · </strong>}{n.summary}</summary><p>{n.detail || m.noNoticeDetails}</p>
              </details>
            ))}
        </section>
      )}
      {(enabled.bikes || enabled.scooters) && (
        <section className="stop-layer-details" aria-label={m.nearby}>
          <h3>{m.within(`${number(NEARBY_METRES, language)} m`)}</h3>
          {enabled.bikes && (!bikes ? <p>{m.findBikes}</p> : bikes.failed ? <p>{m.bikesRetry}</p>
            : nearbyStations.length === 0 ? <p>{m.noBikes}</p>
            : nearbyStations.map(s => <div key={s.id} className="nearby-station">
              <span>{s.name}<small>{bikeAvailability(s, language)}</small></span><small>{number(s.metres, language)} m</small>
            </div>))}
          {enabled.scooters && <p>{!nearbyScooters ? m.findScooters : nearbyScooters.failed
            ? m.scootersRetry : m.availableScooters(nearbyScooters.rows.length)}</p>}
        </section>
      )}
    </>
  );
}
