import type { Map } from 'maplibre-gl';
import type { MapViewport } from '../../types/transit.ts';

export function readViewport(map: Map): MapViewport {
  const bounds = map.getBounds();
  return {
    bbox: { minLat: bounds.getSouth(), maxLat: bounds.getNorth(), minLon: bounds.getWest(), maxLon: bounds.getEast() },
    zoom: map.getZoom(),
  };
}
