import type maplibregl from 'maplibre-gl';
import type { AvailableScooter, BikeStation, DisruptedStop, StopNotice } from '../../types/transit.ts';
import { approxDistKm } from '../../services/geo.ts';
import { bikeAvailability, SCOOTER_MIN_ZOOM } from '../../services/sharedMobility.ts';
import type { PointFeature, PointFeatureCollection } from './geojson.ts';

export const BIKE_MIN_ZOOM = 13;
export const LOCAL_LAYERS = ['bike-stations', 'available-scooters', 'stop-notices'];

function noticeOverviews(stops: DisruptedStop[]): PointFeature[] {
  const groups = new Map<string, { notice: StopNotice; stops: DisruptedStop[] }>();
  for (const stop of stops) {
    for (const notice of stop.notices) {
      const group = groups.get(notice.id);
      if (group) group.stops.push(stop);
      else groups.set(notice.id, { notice, stops: [stop] });
    }
  }

  return Array.from(groups.values(), ({ notice, stops: linked }) => {
    const lon = linked.reduce((sum, stop) => sum + stop.longitude, 0) / linked.length;
    const lat = linked.reduce((sum, stop) => sum + stop.latitude, 0) / linked.length;
    // Anchor to a real stop so zooming in on the overview reveals a stop marker.
    const anchor = linked.reduce((best, stop) =>
      approxDistKm(lon, lat, stop.longitude, stop.latitude) < approxDistKm(lon, lat, best.longitude, best.latitude)
        ? stop : best);
    const count = linked.length;
    return {
      type: 'Feature', geometry: { type: 'Point', coordinates: [anchor.longitude, anchor.latitude] },
      properties: {
        kind: 'notice-overview', id: notice.id, label: notice.summary,
        detail: [notice.detail, `${count} linked ${count === 1 ? 'stop' : 'stops'}. Zoom in for stop details.`].filter(Boolean).join(' '),
      },
    };
  });
}

export function localFeatures(bikes: BikeStation[], scooters: AvailableScooter[], stops: DisruptedStop[], showStops = false): PointFeatureCollection {
  function point(lon: number, lat: number, properties: PointFeature['properties']): PointFeature {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties };
  }
  return {
    type: 'FeatureCollection',
    features: [
      ...bikes.map(b => point(b.lon, b.lat, {
        kind: 'bike-stations', id: b.id, label: b.name,
        detail: bikeAvailability(b), bikes: b.bikes, docks: b.docks,
        ...(b.capacity !== undefined && { capacity: b.capacity }),
      })),
      ...scooters.map(s => point(s.lon, s.lat, {
        kind: 'available-scooters', id: s.id, label: `${s.operator} scooter`, detail: 'Available for pickup',
      })),
      ...(showStops ? stops.map(s => point(s.longitude, s.latitude, {
        kind: 'stop-notices', id: s.id, label: s.name,
      })) : noticeOverviews(stops)),
    ],
  };
}

export function addLocalLayers(map: maplibregl.Map) {
  map.addSource('local-layers', {
    type: 'geojson', data: localFeatures([], [], []),
    attribution: '<a href="https://oslobysykkel.no/apne-data">Oslo Bysykkel</a> · <a href="https://entur.org/">Entur</a> · Ruter · Voi · Bolt · Ryde',
  });
  const notices: maplibregl.FilterSpecification = ['in', ['get', 'kind'], ['literal', ['stop-notices', 'notice-overview']]];
  for (const [id, color, minzoom, radius] of [
    ['bike-stations', '#55dba7', BIKE_MIN_ZOOM, 6],
    ['available-scooters', '#c4a2ff', SCOOTER_MIN_ZOOM, 4],
    ['stop-notices', '#ffbd58', 8, 8],
  ] as const) {
    map.addLayer({
      id, type: 'circle', source: 'local-layers', minzoom,
      filter: id === 'stop-notices' ? notices : ['==', ['get', 'kind'], id],
      paint: {
        'circle-radius': radius, 'circle-color': color, 'circle-stroke-color': '#132033',
        'circle-stroke-width': 1.5,
      },
    }, id === 'stop-notices' ? 'vehicles-halo' : 'network-stops-circle');
  }
  map.addLayer({
    id: 'notice-symbol', type: 'symbol', source: 'local-layers', minzoom: 8,
    filter: notices,
    layout: { 'text-field': '!', 'text-size': 12, 'text-font': ['Open Sans Semibold'], 'text-allow-overlap': true, 'text-ignore-placement': true },
    paint: { 'text-color': '#132033' },
  }, 'vehicles-halo');
}
