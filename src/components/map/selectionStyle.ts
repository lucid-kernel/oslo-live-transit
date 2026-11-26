import type { ExpressionSpecification, Map } from 'maplibre-gl';

export function styleSelectedVehicle(map: Map, id: string | null) {
  const selected: ExpressionSpecification = ['==', ['get', 'id'], id ?? ''];
  const estimated: ExpressionSpecification = ['==', ['get', 'positionSource'], 'estimated'];
  map.setFilter('vehicles-selected-ring', selected);
  map.setPaintProperty('vehicles-halo', 'circle-opacity', id ? ['case', selected, 0.34, 0.05] : 0.2);
  map.setPaintProperty('vehicles-body', 'circle-opacity', id
    ? ['case', selected, ['case', estimated, 0.9, 1], 0.2]
    : ['case', estimated, 0.82, 1]);
  map.setPaintProperty('vehicles-body', 'circle-stroke-opacity', id ? ['case', selected, 1, 0.2] : 1);
  map.setPaintProperty('vehicles-heading', 'icon-opacity', id ? ['case', selected, 1, 0.18] : 1);
  map.setPaintProperty('vehicles-label', 'text-opacity', id ? ['case', selected, 1, 0.2] : 1);
}
