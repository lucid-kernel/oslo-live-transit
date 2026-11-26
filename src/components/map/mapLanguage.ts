import { useEffect, type RefObject } from 'react';
import type { Map as TransitMap } from 'maplibre-gl';
import { locales, messages, type Language } from '../../i18n/language.ts';

export function useMapLanguage(ref: RefObject<TransitMap | null>, language: Language, title: string) {
  useEffect(() => {
    const map = ref.current;
    if (!map) return;
    const m = messages[language];

    // MapLibre 5 reads this table when creating controls, markers and popups.
    // Existing controls have already copied their labels into the DOM.
    Object.assign(map._locale, {
      'Map.Title': title,
      'Marker.Title': m.marker,
      'Popup.Close': m.closePopup,
      'NavigationControl.ZoomIn': m.zoomIn,
      'NavigationControl.ZoomOut': m.zoomOut,
      'NavigationControl.ResetBearing': m.resetNorth,
      'AttributionControl.ToggleAttribution': m.attribution,
      'AttributionControl.MapFeedback': m.feedback,
    });

    const container = map.getContainer();
    map.getCanvas().setAttribute('aria-label', title);
    for (const [selector, label] of [
      ['.maplibregl-ctrl-zoom-in', m.zoomIn],
      ['.maplibregl-ctrl-zoom-out', m.zoomOut],
      ['.maplibregl-ctrl-compass', m.resetNorth],
      ['.maplibregl-ctrl-attrib-button', m.attribution],
      ['.maplibregl-marker', m.marker],
      ['.maplibregl-popup-close-button', m.closePopup],
    ]) {
      for (const element of container.querySelectorAll<HTMLElement>(selector)) {
        element.setAttribute('aria-label', label);
        if (element.hasAttribute('title')) element.title = label;
      }
    }

    function updateMapLabels() {
      if (!map) return;
      if (map.getLayer('scooter-counts')) {
        map.setLayoutProperty('scooter-counts', 'text-field', [
          'number-format', ['coalesce', ['get', 'total'], ['get', 'count']], { locale: locales[language] },
        ]);
      }
      for (const layer of map.getStyle()?.layers ?? []) {
        if (layer.type !== 'symbol' || layer.source !== 'protomaps') continue;
        const field = layer.layout?.['text-field'];
        if (!JSON.stringify(field ?? '').includes('"name"')) continue;
        map.setLayoutProperty(layer.id, 'text-field', language === 'nb'
          ? ['coalesce', ['get', 'name:nb'], ['get', 'name:no'], ['get', 'name']]
          : ['coalesce', ['get', 'name:en'], ['get', 'name']]);
      }
    }

    updateMapLabels();
    // The load event also covers a language change before the style arrives.
    map.once('load', updateMapLabels);
    return () => { map.off('load', updateMapLabels); };
  }, [ref, language, title]);
}
