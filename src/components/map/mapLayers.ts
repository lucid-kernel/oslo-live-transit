import type maplibregl from 'maplibre-gl';
import { OSLO_HUBS } from '../../services/entur.ts';
import {
  buildHubFeatures,
  buildJourneyLineFeature,
  buildJourneyStopFeatures,
  buildNetworkRouteFeatures,
  buildNetworkStopFeatures,
  buildVehicleFeatures,
} from './geojson.ts';

function createHeadingArrowImage(): ImageData {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new ImageData(size, size);

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(size / 2, 2);
  ctx.lineTo(size / 2 + 9, 17);
  ctx.lineTo(size / 2, 13);
  ctx.lineTo(size / 2 - 9, 17);
  ctx.closePath();
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
}

/** Registers SDF icons, GeoJSON sources, and ordered MapLibre layers for Oslo transit. */
export function addTransitMapLayers(map: maplibregl.Map): void {
  if (!map.hasImage('vehicle-arrow')) {
    map.addImage('vehicle-arrow', createHeadingArrowImage(), { sdf: true });
  }

  // Dedicated Network Routes & Stops (Metro / Train / Tram / Bus stop routes)
  map.addSource('network-routes', {
    type: 'geojson',
    data: buildNetworkRouteFeatures(null),
  });

  const metroLineOffset: maplibregl.ExpressionSpecification = [
    'case',
    ['==', ['get', 'mode'], 'metro'],
    ['match', ['get', 'lineCode'], '1', -6, '2', -3, '3', 0, '4', 3, '5', 6, 0],
    0,
  ];

  map.addLayer({
    id: 'network-routes-glow',
    type: 'line',
    source: 'network-routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': 4.5,
      'line-color': ['get', 'color'],
      'line-opacity': 0.16,
      'line-offset': metroLineOffset,
    },
  });

  map.addLayer({
    id: 'network-routes-line',
    type: 'line',
    source: 'network-routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': 2.5,
      'line-color': ['get', 'color'],
      'line-opacity': 0.9,
      'line-offset': metroLineOffset,
    },
  });

  map.addSource('network-stops', {
    type: 'geojson',
    data: buildNetworkStopFeatures(null),
  });

  map.addLayer({
    id: 'network-stops-circle',
    type: 'circle',
    source: 'network-stops',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 14, 6],
      'circle-color': '#090d16',
      'circle-stroke-width': 2,
      'circle-stroke-color': ['get', 'color'],
      'circle-opacity': 0.95,
    },
  });

  map.addLayer({
    id: 'network-stops-label',
    type: 'symbol',
    source: 'network-stops',
    minzoom: 11.6,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Semibold'],
      'text-size': 10.5,
      'text-offset': [0, 1.15],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-padding': 2,
    },
    paint: {
      'text-color': '#cbd5e1',
      'text-halo-color': '#090d16',
      'text-halo-width': 1.5,
    },
  });

  // Oslo Transit Hubs
  map.addSource('oslo-hubs', {
    type: 'geojson',
    data: buildHubFeatures(OSLO_HUBS),
  });

  map.addLayer({
    id: 'hubs-circle',
    type: 'circle',
    source: 'oslo-hubs',
    paint: {
      'circle-radius': 6,
      'circle-color': '#0b1120',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#38bdf8',
      'circle-opacity': 0.9,
    },
  });

  map.addLayer({
    id: 'hubs-label',
    type: 'symbol',
    source: 'oslo-hubs',
    minzoom: 11.2,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Semibold'],
      'text-size': 11,
      'text-offset': [0, 1.3],
      'text-anchor': 'top',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#bae6fd',
      'text-halo-color': '#090d16',
      'text-halo-width': 1.5,
    },
  });

  // Selected Vehicle Travel Path & History
  map.addSource('journey-past', {
    type: 'geojson',
    data: buildJourneyLineFeature([], '#94a3b8'),
  });

  map.addLayer({
    id: 'journey-past-line',
    type: 'line',
    source: 'journey-past',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': 3.2,
      'line-color': '#94a3b8',
      'line-opacity': 0.6,
      'line-dasharray': [2, 2],
    },
  });

  map.addSource('journey-remaining', {
    type: 'geojson',
    data: buildJourneyLineFeature([], '#38bdf8'),
  });

  map.addLayer({
    id: 'journey-remaining-line',
    type: 'line',
    source: 'journey-remaining',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': 4,
      'line-color': ['get', 'color'],
      'line-opacity': 0.95,
    },
  });

  map.addSource('journey-stops', {
    type: 'geojson',
    data: buildJourneyStopFeatures(null, '#38bdf8'),
  });

  map.addLayer({
    id: 'journey-stops-circle',
    type: 'circle',
    source: 'journey-stops',
    paint: {
      'circle-radius': ['case', ['==', ['get', 'passed'], 1], 3.5, 4.8],
      'circle-color': ['case', ['==', ['get', 'passed'], 1], '#1e293b', '#090d16'],
      'circle-stroke-width': 2,
      'circle-stroke-color': ['get', 'color'],
    },
  });

  // Live Vehicles
  map.addSource('vehicles', {
    type: 'geojson',
    data: buildVehicleFeatures([], new Map()),
  });

  map.addLayer({
    id: 'vehicles-halo',
    type: 'circle',
    source: 'vehicles',
    paint: {
      'circle-radius': 13,
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.2,
    },
  });

  map.addLayer({
    id: 'vehicles-selected-ring',
    type: 'circle',
    source: 'vehicles',
    filter: ['==', ['get', 'id'], ''],
    paint: {
      'circle-radius': 15,
      'circle-color': 'transparent',
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#f8fafc',
    },
  });

  map.addLayer({
    id: 'vehicles-body',
    type: 'circle',
    source: 'vehicles',
    paint: {
      'circle-radius': 7.5,
      'circle-color': ['get', 'color'],
      'circle-opacity': ['case', ['==', ['get', 'positionSource'], 'estimated'], 0.82, 1],
      'circle-stroke-width': ['case', ['==', ['get', 'positionSource'], 'estimated'], 1.5, 1.8],
      'circle-stroke-color': [
        'case',
        ['has', 'boardingProgress'],
        ['interpolate', ['linear'], ['number', ['get', 'boardingProgress']],
          0, 'rgba(248, 250, 252, 0.6)',
          0.45, 'rgba(248, 250, 252, 0.95)',
          1, 'rgba(248, 250, 252, 0.73)'],
        ['==', ['get', 'positionSource'], 'estimated'],
        'rgba(248, 250, 252, 0.6)',
        '#090d16',
      ],
    },
  });

  map.addLayer({
    id: 'vehicles-heading',
    type: 'symbol',
    source: 'vehicles',
    filter: ['==', ['get', 'hasBearing'], 1],
    layout: {
      'icon-image': 'vehicle-arrow',
      'icon-size': 0.72,
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: {
      'icon-color': ['get', 'color'],
      'icon-halo-color': '#090d16',
      'icon-halo-width': 1,
    },
  });

  map.addLayer({
    id: 'vehicles-label',
    type: 'symbol',
    source: 'vehicles',
    minzoom: 11.4,
    layout: {
      'text-field': ['get', 'lineCode'],
      'text-font': ['Open Sans Bold'],
      'text-size': 10.5,
      'text-offset': [0, -1.55],
      'text-anchor': 'bottom',
      'text-allow-overlap': false,
      'text-padding': 2,
    },
    paint: {
      'text-color': '#f8fafc',
      'text-halo-color': '#090d16',
      'text-halo-width': 1.6,
    },
  });
}
