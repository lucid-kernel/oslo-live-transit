import type { Popup } from 'maplibre-gl';
import type { PointFeature } from './geojson.ts';

export function setLocalPopupContent(popup: Popup, properties: PointFeature['properties']) {
  const { kind, label, detail, capacity, docks, bikes } = properties;
  if (kind !== 'bike-stations' || typeof capacity !== 'number' || !Number.isSafeInteger(capacity)
    || capacity <= 0 || typeof docks !== 'number' || !Number.isInteger(docks) || docks < 0 || docks > capacity) {
    popup.setText(`${label} · ${detail}`);
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'bike-dock-popup';
  const name = document.createElement('strong');
  name.textContent = String(label);
  const availability = document.createElement('span');
  availability.textContent = `${docks} of ${capacity} ${capacity === 1 ? 'dock' : 'docks'} free`;
  const slots = document.createElement('div');
  slots.className = 'bike-dock-slots';
  slots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < capacity; i++) {
    const slot = document.createElement('span');
    if (i < docks) slot.className = 'free';
    slots.append(slot);
  }
  const pickup = document.createElement('small');
  pickup.textContent = `${bikes} ${bikes === 1 ? 'bike' : 'bikes'} available`;
  panel.append(name, availability, slots, pickup);
  popup.setDOMContent(panel);
}
