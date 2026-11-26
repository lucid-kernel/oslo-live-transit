import { useLanguage } from '../i18n/LanguageProvider.tsx';
import { Layers } from 'lucide-react';
import type { LocalLayers } from '../hooks/useLocalLayers.ts';
import { SCOOTER_MIN_ZOOM } from '../services/sharedMobility.ts';
import { BIKE_MIN_ZOOM } from './map/localLayers.ts';

export function LocalLayersControl({ layers, zoom }: { layers: LocalLayers; zoom: number }) {
  const { m } = useLanguage();
  const options = [
    { key: 'bikes', name: m.bikesLayer, note: zoom < BIKE_MIN_ZOOM ? m.zoomBikes : 'Oslo Bysykkel' },
    { key: 'notices', name: m.noticesLayer, note: m.disruptions },
    { key: 'scooters', name: m.scootersLayer, note: zoom < SCOOTER_MIN_ZOOM ? m.zoomScooters : m.operators },
  ] as const;
  return (
    <details className="glass-panel local-layers">
      <summary><Layers size={16} aria-hidden="true" /> {m.mapLayers}</summary>
      {options.map(({ key, name, note }) => (
        <label key={key} className={`layer-option layer-${key}`}>
          <input type="checkbox" checked={layers.enabled[key]} onChange={event => {
            const checked = event.target.checked;
            layers.setEnabled(previous => ({ ...previous, [key]: checked }));
          }} />
          <span>{name}<small>{layers[key]?.failed ? m.feedRetry : note}</small></span>
        </label>
      ))}
    </details>
  );
}
