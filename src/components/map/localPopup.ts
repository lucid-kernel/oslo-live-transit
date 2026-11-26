import { messages, number, type Language } from '../../i18n/language.ts';
import type { Popup } from 'maplibre-gl';
import type { PointFeature } from './geojson.ts';

export function setLocalPopupContent(popup: Popup, properties: PointFeature['properties'], language: Language) {
  const m = messages[language];
  const { kind, label, detail, capacity, docks, bikes } = properties;
  if (kind !== 'bike-stations' || typeof capacity !== 'number' || !Number.isSafeInteger(capacity)
    || capacity <= 0 || typeof docks !== 'number' || !Number.isInteger(docks) || docks < 0 || docks > capacity) {
    popup.setText([label, detail].filter(Boolean).join(' · '));
    labelCloseButton(popup, language);
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'bike-dock-popup';
  const name = document.createElement('strong');
  name.textContent = String(label);
  const availability = document.createElement('span');
  availability.textContent = m.freeCapacity(number(docks, language), number(capacity, language));
  const slots = document.createElement('div');
  slots.className = 'bike-dock-slots';
  slots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < capacity; i++) {
    const slot = document.createElement('span');
    if (i < docks) slot.className = 'free';
    slots.append(slot);
  }
  const pickup = document.createElement('small');
  pickup.textContent = m.availableBikes(Number(bikes));
  panel.append(name, availability, slots, pickup);
  popup.setDOMContent(panel);
  labelCloseButton(popup, language);
}

// Replacing popup content also replaces MapLibre’s close button.
function labelCloseButton(popup: Popup, language: Language) {
  popup.getElement()?.querySelector('.maplibregl-popup-close-button')
    ?.setAttribute('aria-label', messages[language].closePopup);
}
