import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { LocateFixed, X } from 'lucide-react';
import type { AvailableScooter } from '../types/transit.ts';
import { SCOOTER_OPERATORS } from '../services/sharedMobility.ts';
import { isWithinBbox } from '../services/geo.ts';
import { OSLO_CENTER } from '../services/entur.ts';
import { useScooterAvailability, type ScooterViewport } from '../hooks/useScooterAvailability.ts';
import { addScooterLayers, groupScooters } from './map/scooterLayers.ts';
import { DARK_MATTER_STYLE } from './map/mapLayers.ts';
import { ScooterCard } from './ScooterCard.tsx';

const EMPTY: AvailableScooter[] = [];

export function ScooterView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [view, setView] = useState<ScooterViewport | null>(null);
  const [operators, setOperators] = useState(SCOOTER_OPERATORS);
  const { snapshot, failed, current, retry } = useScooterAvailability(view);
  const rows = snapshot?.rows ?? EMPTY;
  const grouped = useMemo(() => groupScooters(rows, operators), [rows, operators]);
  const latest = useRef(grouped);
  latest.current = grouped;
  const [selected, setSelected] = useState<AvailableScooter | null>(null);
  const [stack, setStack] = useState<string[]>([]);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const marker = useRef<maplibregl.Marker | null>(null);
  const count = useMemo(() => view && current
    ? rows.filter(s => operators.includes(s.operator) && isWithinBbox(s.lat, s.lon, view.bbox)).length
    : null, [rows, operators, current, view]);

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current, style: DARK_MATTER_STYLE, center: [OSLO_CENTER.longitude, OSLO_CENTER.latitude],
      zoom: 10.8, maxZoom: 19, minZoom: 6, dragRotate: false, pitchWithRotate: false,
      maxPitch: 0, attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    const updateView = () => {
      const b = map.getBounds();
      setView({ bbox: { minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast() }, zoom: map.getZoom() });
    };
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    let clickSequence = 0;
    map.on('load', () => {
      addScooterLayers(map, latest.current.geojson);
      updateView();
      map.on('moveend', updateView);
      map.on('mouseenter', 'scooter-pins', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'scooter-pins', () => { map.getCanvas().style.cursor = ''; });
      map.on('click', async e => {
        const sequence = ++clickSequence;
        const hits = map.queryRenderedFeatures(e.point, { layers: ['scooter-pins'] });
        const hit = hits[0];
        setSelected(null);
        setStack([]);
        if (!hit || hit.geometry.type !== 'Point') return;
        if (hit.properties.cluster) {
          const source = map.getSource('scooter-pickups') as maplibregl.GeoJSONSource;
          try {
            const zoom = await source.getClusterExpansionZoom(hit.properties.cluster_id);
            if (sequence === clickSequence) map.easeTo({ center: [hit.geometry.coordinates[0], hit.geometry.coordinates[1]], zoom });
          } catch { /* Refreshing the source can retire a cluster during a click. */ }
          return;
        }
        const keys = [...new Set(hits.filter(h => !h.properties.cluster).map(h => String(h.properties.key)))];
        const scooters = keys.flatMap(key => latest.current.spots.get(key) ?? []);
        if (scooters.length === 1) setSelected(scooters[0]);
        else setStack(keys);
      });
    });
    return () => {
      clickSequence++;
      resize.disconnect();
      marker.current?.remove();
      mapRef.current = null;
      map.remove();
    };
  }, []);
  useEffect(() => {
    mapRef.current?.getSource<maplibregl.GeoJSONSource>('scooter-pickups')?.setData(grouped.geojson);
  }, [grouped]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSelected(null); setStack([]); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);

  const locate = () => {
    const map = mapRef.current;
    if (!map || !navigator.geolocation) { setLocationError('Location unavailable on this device.'); return; }
    setLocating(true);
    setLocationError('');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (mapRef.current !== map) return;
      setLocating(false);
      const center: [number, number] = [coords.longitude, coords.latitude];
      marker.current?.remove();
      marker.current = new maplibregl.Marker({ color: '#38bdf8' }).setLngLat(center).addTo(map);
      map.easeTo({ center, zoom: 16 });
    }, error => {
      if (mapRef.current !== map) return;
      setLocating(false);
      setLocationError(error.code === 1 ? 'Location access denied. Explore by moving the map.' : 'Could not find your location.');
    }, { timeout: 12_000, maximumAge: 30_000 });
  };

  const choices = stack.flatMap(key => grouped.spots.get(key) ?? []);
  const unavailable = !!(selected && snapshot && isWithinBbox(selected.lat, selected.lon, snapshot.scope)
    && !rows.some(row => row.id === selected.id));
  return <>
    <div className="map-container" ref={container} aria-label="Available scooter map" />
    <div className="hud-top-left">
      <section className="glass-panel scooter-panel" aria-label="Scooter controls">
        <header><div><h1>Scooters</h1><p><strong>{count == null ? '—' : count.toLocaleString()}</strong> Available in map area</p></div>
          <button className="scooter-location" onClick={locate} disabled={locating}><LocateFixed size={16} />{locating ? 'Locating…' : 'My location'}</button>
        </header>
        <div className="scooter-operators" role="group" aria-label="Scooter operators">
          {SCOOTER_OPERATORS.map(op => <button key={op} type="button" aria-pressed={operators.includes(op)} onClick={() => {
            setOperators(previous => previous.includes(op) ? previous.filter(value => value !== op) : [...previous, op]);
            if (selected?.operator === op) setSelected(null);
          }}>{op}</button>)}
        </div>
        {failed ? <p role="status">{snapshot ? `Refresh failed · last updated ${new Date(snapshot.updated).toLocaleTimeString()}` : 'Scooter availability unavailable.'} <button className="retry-btn" onClick={retry}>Retry</button></p>
          : !current && <p role="status">Loading scooter availability…</p>}
        {locationError && <p role="status">{locationError}</p>}
      </section>
    </div>
    {(selected || stack.length > 0) && <div className="hud-right-drawer">
      {selected ? <ScooterCard key={selected.id} scooter={selected} unavailable={unavailable} close={() => setSelected(null)} />
        : <aside className="glass-panel scooter-card"><header><h2>Scooters at this spot</h2><button className="icon-btn" aria-label="Close scooter list" onClick={() => setStack([])}><X size={16} /></button></header>
          {choices.length === 0 && <p>No available scooters here.</p>}
          {choices.map(s => <button key={s.id} className="scooter-choice" onClick={() => setSelected(s)}>{s.operator} scooter <small>{s.id.split(':').pop()?.slice(-8)}</small></button>)}
        </aside>}
    </div>}
  </>;
}
