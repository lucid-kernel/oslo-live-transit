import type maplibregl from 'maplibre-gl';
import type { AvailableScooter } from '../../types/transit.ts';
import { SCOOTER_MIN_ZOOM } from '../../services/sharedMobility.ts';
import type { PointFeatureCollection } from './geojson.ts';

export function groupScooters(rows: AvailableScooter[], operators: string[]) {
  const spots = new Map<string, AvailableScooter[]>();
  for (const row of rows) {
    if (!operators.includes(row.operator)) continue;
    const key = `${row.lon},${row.lat}`;
    const atSpot = spots.get(key);
    if (atSpot) atSpot.push(row);
    else spots.set(key, [row]);
  }
  const geojson: PointFeatureCollection = { type: 'FeatureCollection', features: [] };
  for (const [key, scooters] of spots) {
    const { lon, lat } = scooters[0];
    geojson.features.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { key, count: scooters.length },
    });
  }
  return { spots, geojson };
}

export function addScooterLayers(map: maplibregl.Map, data: PointFeatureCollection) {
  map.addSource('scooter-pickups', {
    type: 'geojson', data, cluster: true, clusterRadius: 42, clusterMaxZoom: SCOOTER_MIN_ZOOM - 1,
    clusterProperties: { total: ['+', ['get', 'count']] },
    attribution: 'Entur · Voi · Bolt · Ryde',
  });
  const count: maplibregl.ExpressionSpecification = ['coalesce', ['get', 'total'], ['get', 'count']];
  map.addLayer({
    id: 'scooter-pins', type: 'circle', source: 'scooter-pickups',
    paint: {
      'circle-color': ['case', ['>', count, 1], '#c4a2ff', '#ac7cf0'],
      'circle-radius': ['step', count, 6, 2, 12, 10, 15, 100, 19, 1000, 23],
      'circle-stroke-width': 2, 'circle-stroke-color': '#261e38',
    },
  });
  map.addLayer({
    id: 'scooter-counts', type: 'symbol', source: 'scooter-pickups', filter: ['>', count, 1],
    layout: { 'text-field': ['to-string', count], 'text-size': 12, 'text-font': ['Open Sans Semibold'],
      'text-allow-overlap': true, 'text-ignore-placement': true },
    paint: { 'text-color': '#20152d' },
  });
}
