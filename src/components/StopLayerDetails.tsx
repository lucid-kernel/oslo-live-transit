import type { LocalLayers } from '../hooks/useLocalLayers.ts';
import { bikeAvailability, NEARBY_METRES } from '../services/sharedMobility.ts';

export function StopLayerDetails({ layers }: { layers: LocalLayers }) {
  const { enabled, bikes, notices, stopNotices, nearbyStations, nearbyScooters } = layers;
  return (
    <>
      {enabled.notices && (!notices || notices.failed || stopNotices.length > 0) && (
        <section aria-label="Service notices" className="stop-layer-details">
          <h3>Service notices</h3>
          {!notices ? <p>Checking Ruter notices…</p> : notices.failed ? <p>Notices unavailable · retrying</p> :
            stopNotices.map(n => (
              <details key={n.id} className="stop-notice">
                <summary>{n.lines.length > 0 && <strong>{n.lines.length === 1 ? 'Line' : 'Lines'} {n.lines.join(', ')} · </strong>}{n.summary}</summary><p>{n.detail || 'No further details from Ruter.'}</p>
              </details>
            ))}
        </section>
      )}
      {(enabled.bikes || enabled.scooters) && (
        <section className="stop-layer-details" aria-label="Nearby shared mobility">
          <h3>Within {NEARBY_METRES} m</h3>
          {enabled.bikes && (!bikes ? <p>Finding bike stations…</p> : bikes.failed ? <p>Bike stations unavailable · retrying</p>
            : nearbyStations.length === 0 ? <p>No city-bike stations nearby</p>
            : nearbyStations.map(s => <div key={s.id} className="nearby-station">
              <span>{s.name}<small>{bikeAvailability(s)}</small></span><small>{s.metres} m</small>
            </div>))}
          {enabled.scooters && <p>{!nearbyScooters ? 'Finding scooters…' : nearbyScooters.failed
            ? 'Scooters unavailable · retrying' : `${nearbyScooters.rows.length} available scooter${nearbyScooters.rows.length === 1 ? '' : 's'}`}</p>}
        </section>
      )}
    </>
  );
}
