import { useEffect, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { fetchScooterDetails, scooterRentalLink, type ScooterDetails } from '../services/sharedMobility.ts';
import type { AvailableScooter } from '../types/transit.ts';

export function ScooterCard({ scooter, unavailable, close }: {
  scooter: AvailableScooter; unavailable: boolean; close: () => void;
}) {
  const [details, setDetails] = useState<ScooterDetails | null>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (unavailable) return;
    const controller = new AbortController();
    setDetails(undefined);
    setError(false);
    const timer = window.setTimeout(async () => {
      try {
        const result = await fetchScooterDetails(scooter.id, controller.signal);
        if (!controller.signal.aborted) setDetails(result);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [scooter.id, unavailable, attempt]);
  const link = details && scooterRentalLink(scooter.operator, details.rentalUris);
  return (
    <aside className="glass-panel scooter-card" aria-label="Scooter details">
      <header><h2>{scooter.operator} scooter</h2><button className="icon-btn" aria-label="Close scooter details" onClick={close}><X size={16} /></button></header>
      {unavailable || details === null ? <p>This scooter is no longer available.</p>
        : error ? <p>Details unavailable. <button className="retry-btn" onClick={() => setAttempt(a => a + 1)}>Retry</button></p>
        : !details ? <p>Checking availability…</p> : <>
          <dl>
            {details.currentFuelPercent != null && <div><dt>Battery</dt><dd>{Math.round(details.currentFuelPercent * 100)}%</dd></div>}
            {details.currentRangeMeters != null && <div><dt>Estimated range</dt><dd>{(details.currentRangeMeters / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km</dd></div>}
          </dl>
          {link ? <a className="scooter-rental" href={link} target="_blank" rel="noopener noreferrer">Open in {scooter.operator}<ExternalLink size={14} /></a>
            : <p>Open the operator’s app on your phone.</p>}
        </>}
    </aside>
  );
}
