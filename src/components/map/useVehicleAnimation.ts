import { useEffect, useEffectEvent, useRef, type RefObject } from 'react';
import type { Map as TransitMap, GeoJSONSource } from 'maplibre-gl';
import type { LiveVehicle } from '../../types/transit.ts';
import { buildVehicleFeatures, type VehicleAnimState } from './geojson.ts';
import { createGpsTrackMap, stepVehiclePositions, FRAME_INTERVAL_MS, type GpsTrackState } from './vehicleMotion.ts';

export function useVehicleAnimation(map: TransitMap | null, vehicles: LiveVehicle[], followVehicleId: string | null, gesture: RefObject<boolean>) {
  const vehiclesByIdRef = useRef(new Map<string, LiveVehicle>());
  const currentPosRef = useRef(new Map<string, VehicleAnimState>());
  const gpsTrackRef = useRef(new Map<string, GpsTrackState>());
  useEffect(() => {
    const nowPerf = performance.now();

    const nextById = new Map<string, LiveVehicle>();
    for (const v of vehicles) nextById.set(v.id, v);
    vehiclesByIdRef.current = nextById;
    gpsTrackRef.current = createGpsTrackMap(vehicles, currentPosRef.current, nowPerf);
  }, [vehicles]);

  const animate = useEffectEvent((map: TransitMap, nowPerf: number, dtSec: number, reducedMotion: boolean) => {
    const nowMs = Date.now();
    const { positions, vehiclesById } = stepVehiclePositions(
      vehicles,
      gpsTrackRef.current,
      currentPosRef.current,
      nowPerf,
      dtSec,
      nowMs,
    );

    vehiclesByIdRef.current = vehiclesById;
    currentPosRef.current = positions;
    map.getSource<GeoJSONSource>('vehicles')?.setData(buildVehicleFeatures(vehiclesById.values(), positions, nowMs, reducedMotion));

    if (followVehicleId && !gesture.current && !map.isMoving()) {
      const followedPos = positions.get(followVehicleId);
      if (followedPos) {
        const center = map.getCenter();
        const dLng = followedPos.lon - center.lng;
        const dLat = followedPos.lat - center.lat;
        const dist = Math.hypot(dLng, dLat);

        if (dist > 1e-6) {
          // Smoothly glide back after a pinch/zoom; track 1:1 once locked onto the vehicle.
          if (dist < 1.5e-5) {
            map.setCenter([followedPos.lon, followedPos.lat]);
          } else {
            const alpha = 1 - Math.exp(-8 * dtSec);
            map.setCenter([center.lng + dLng * alpha, center.lat + dLat * alpha]);
          }
        }
      }
    }
  });

  const hasVehicles = vehicles.length > 0;
  useEffect(() => {
    if (!map) return;
    if (!hasVehicles) {
      currentPosRef.current.clear();
      map.getSource<GeoJSONSource>('vehicles')?.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame: number;
    let last = 0;
    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      if (now - last < FRAME_INTERVAL_MS) return;
      animate(map, now, (last ? now - last : FRAME_INTERVAL_MS) / 1000, reducedMotion.matches);
      last = now;
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [map, hasVehicles]);
  return { vehiclesByIdRef, currentPosRef };
}
