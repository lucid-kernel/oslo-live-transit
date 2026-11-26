import { MapPin } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageProvider.tsx';
import type { LiveVehicle, OsloHub } from '../types/transit.ts';
import { ModeIcon } from './ModeIcon.tsx';
import { formatDelay, getBadgeStyle, getVehicleColor } from './transitTheme.ts';

export type SearchResultEntry =
  | { kind: 'hub'; key: string; hub: OsloHub }
  | { kind: 'vehicle'; key: string; vehicle: LiveVehicle };

export function SearchResultOption({ entry, active, onSelect }: {
  entry: SearchResultEntry;
  active: boolean;
  onSelect: (entry: SearchResultEntry) => void;
}) {
  const { m } = useLanguage();
  return (
    <button
      id={`search-opt-${entry.key}`}
      type="button"
      role="option"
      aria-selected={active}
      className={`search-result-item${active ? ' active' : ''}`}
      onMouseDown={event => event.preventDefault()}
      onClick={() => onSelect(entry)}
    >
      {entry.kind === 'hub' ? <>
        <span className="search-result-hub-badge" aria-hidden="true"><MapPin size={13} /></span>
        <span className="search-result-main">
          <span className="search-result-title">{entry.hub.name}</span>
          <span className="search-result-meta">{m.hubLive}</span>
        </span>
      </> : <VehicleResult vehicle={entry.vehicle} />}
    </button>
  );
}

function VehicleResult({ vehicle }: { vehicle: LiveVehicle }) {
  const { m, language } = useLanguage();
  const color = getVehicleColor(vehicle);
  const delay = formatDelay(vehicle.delaySeconds, language);
  return <>
    <span className="search-result-badge" style={getBadgeStyle(color)}>{vehicle.lineCode}</span>
    <span className="search-result-main">
      <span className="search-result-title">{vehicle.destination || m.inService}</span>
      <span className="search-result-meta">
        <ModeIcon mode={vehicle.mode} size={11} color={color} />
        <span>{m[vehicle.mode]}</span>
        <span>· {vehicle.operator || m.unknownOperator}</span>
        {vehicle.nextStopName ? ` · ${m.next(vehicle.nextStopName)}` : ''}
      </span>
    </span>
    {delay.text !== '—' && <span className={`search-result-delay ${delay.tone}`}>{delay.text}</span>}
  </>;
}
