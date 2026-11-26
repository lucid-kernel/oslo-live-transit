import { Layers } from 'lucide-react';
import type { LocalLayers } from '../hooks/useLocalLayers.ts';
import { SCOOTER_MIN_ZOOM } from '../services/sharedMobility.ts';
import { BIKE_MIN_ZOOM } from './map/localLayers.ts';

export function LocalLayersControl({ layers, zoom }: { layers: LocalLayers; zoom: number }) {
  const options = [
    { key: 'bikes', name: 'City bikes', note: zoom < BIKE_MIN_ZOOM ? 'Zoom in to see stations' : 'Oslo Bysykkel' },
    { key: 'notices', name: 'Stop notices', note: 'Ruter disruptions and detours' },
    { key: 'scooters', name: 'Available scooters', note: zoom < SCOOTER_MIN_ZOOM ? 'Zoom to street level for pins' : 'Voi, Bolt and Ryde' },
  ] as const;
  return (
    <details className="glass-panel local-layers">
      <summary><Layers size={16} aria-hidden="true" /> Map layers</summary>
      {options.map(({ key, name, note }) => (
        <label key={key} className={`layer-option layer-${key}`}>
          <input type="checkbox" checked={layers.enabled[key]} onChange={event => {
            const checked = event.target.checked;
            layers.setEnabled(previous => ({ ...previous, [key]: checked }));
          }} />
          <span>{name}<small>{layers[key]?.failed ? 'Feed unavailable · retrying' : note}</small></span>
        </label>
      ))}
    </details>
  );
}
