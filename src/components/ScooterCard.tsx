import { locales, number } from '../i18n/language.ts';
import { useLanguage } from '../i18n/LanguageProvider.tsx';
import { useMemo } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { fetchScooterDetails, scooterRentalLink } from '../services/sharedMobility.ts';
import { useRequest } from '../hooks/useRequest.ts';
import type { AvailableScooter } from '../types/transit.ts';

export function ScooterCard({ scooter, unavailable, close }: {
  scooter: AvailableScooter; unavailable: boolean; close: () => void;
}) {
  const { m, language } = useLanguage();
  const load = useMemo(() => unavailable ? null : (signal: AbortSignal) => fetchScooterDetails(scooter.id, signal),
    [scooter.id, unavailable]);
  const { data: details, loading, failed: error, refresh } = useRequest(load);
  const link = details && scooterRentalLink(scooter.operator, details.rentalUris);
  return (
    <aside className="glass-panel scooter-card" aria-label={m.scooterDetails}>
      <header><h2>{m.operatorScooter(scooter.operator)}</h2><button className="icon-btn" aria-label={m.closeScooter} onClick={close}><X size={16} /></button></header>
      {unavailable || (!loading && !error && !details) ? <p>{m.gone}</p>
        : error ? <p>{m.detailsFailed} <button className="retry-btn" onClick={refresh}>{m.retry}</button></p>
        : !details ? <p>{m.checking}</p> : <>
          <dl>
            {details.currentFuelPercent != null && <div><dt>{m.battery}</dt><dd>{new Intl.NumberFormat(locales[language], { style: 'percent' }).format(details.currentFuelPercent)}</dd></div>}
            {details.currentRangeMeters != null && <div><dt>{m.range}</dt><dd>{number(details.currentRangeMeters / 1000, language)} km</dd></div>}
          </dl>
          {link ? <a className="scooter-rental" href={link} target="_blank" rel="noopener noreferrer">{m.openOperator(scooter.operator)}<ExternalLink size={14} /></a>
            : <p>{m.openApp}</p>}
        </>}
    </aside>
  );
}
