import type { LiveVehicle } from '../../types/transit.ts';
import { interpolateEstimatedVehicles } from '../../services/entur.ts';
import type { VehicleAnimState } from './geojson.ts';

export const MAX_DEAD_RECKON_SEC = 15;
export const FRAME_INTERVAL_MS = 33;

const POS_DAMP_TAU_SEC = 0.65;
const BEARING_DAMP_TAU_SEC = 0.35;
const SNAP_THRESHOLD_KM = 2.0;

export interface GpsTrackState {
  targetLon: number;
  targetLat: number;
  targetBearing: number;
  speed: number | null;
  bearing: number | null;
  pollTimePerf: number;
}

function interpolateAngle(start: number, end: number, t: number): number {
  const delta = ((((end - start) % 360) + 540) % 360) - 180;
  return (start + delta * t + 360) % 360;
}

function approxDistanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLatKm = (lat2 - lat1) * 111.32;
  const dLonKm = (lon2 - lon1) * 111.32 * Math.max(0.1, Math.cos((lat1 * Math.PI) / 180));
  return Math.hypot(dLatKm, dLonKm);
}

function deadReckonPosition(
  lon: number,
  lat: number,
  bearingDeg: number,
  speedMps: number,
  dtSec: number,
): { lon: number; lat: number } {
  const distMeters = speedMps * dtSec;
  const rad = (bearingDeg * Math.PI) / 180;
  const dLat = (distMeters * Math.cos(rad)) / 111320;
  const cosLat = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const dLon = (distMeters * Math.sin(rad)) / (111320 * cosLat);
  return { lon: lon + dLon, lat: lat + dLat };
}

/** Builds fresh GPS dead-reckoning anchor states when a new vehicle poll arrives. */
export function createGpsTrackMap(
  vehicles: LiveVehicle[],
  currentPositions: Map<string, VehicleAnimState>,
  nowPerf: number,
): Map<string, GpsTrackState> {
  const tracks = new Map<string, GpsTrackState>();

  for (const v of vehicles) {
    if (v.positionSource !== 'gps') continue;
    const prev = currentPositions.get(v.id);
    tracks.set(v.id, {
      targetLon: v.longitude,
      targetLat: v.latitude,
      targetBearing: v.bearing ?? prev?.bearing ?? 0,
      speed: v.speed,
      bearing: v.bearing,
      pollTimePerf: nowPerf,
    });
  }

  return tracks;
}

/**
 * Advances all active vehicles (both estimated and GPS) using exponential damping
 * toward their live target position so 20-30s schedule/GPS updates never cause visual jumps.
 */
export function stepVehiclePositions(
  activeVehicles: LiveVehicle[],
  gpsTracks: Map<string, GpsTrackState>,
  prevPositions: Map<string, VehicleAnimState>,
  nowPerf: number,
  dtSec: number,
  nowMs: number,
): {
  positions: Map<string, VehicleAnimState>;
  vehiclesById: Map<string, LiveVehicle>;
} {
  const estimatedById = new Map<string, LiveVehicle>();
  for (const ev of interpolateEstimatedVehicles(nowMs)) {
    estimatedById.set(ev.id, ev);
  }

  const clampedDt = Math.min(0.2, Math.max(0.001, dtSec));
  const alphaPos = 1 - Math.exp(-clampedDt / POS_DAMP_TAU_SEC);
  const alphaBearing = 1 - Math.exp(-clampedDt / BEARING_DAMP_TAU_SEC);

  const positions = new Map<string, VehicleAnimState>();
  const vehiclesById = new Map<string, LiveVehicle>();

  for (const v of activeVehicles) {
    let targetLon = v.longitude;
    let targetLat = v.latitude;
    let targetBearing = v.bearing ?? prevPositions.get(v.id)?.bearing ?? 0;

    if (v.positionSource === 'estimated') {
      const updated = estimatedById.get(v.id) ?? v;
      vehiclesById.set(v.id, updated);
      targetLon = updated.longitude;
      targetLat = updated.latitude;
      targetBearing = updated.bearing ?? targetBearing;
    } else {
      vehiclesById.set(v.id, v);
      const track = gpsTracks.get(v.id);
      if (track) {
        const elapsedSec = Math.max(0, (nowPerf - track.pollTimePerf) / 1000);
        const cappedDt = Math.min(MAX_DEAD_RECKON_SEC, elapsedSec);
        targetLon = track.targetLon;
        targetLat = track.targetLat;
        targetBearing = track.targetBearing;

        if (track.speed !== null && track.speed > 0.5 && track.bearing !== null) {
          const dr = deadReckonPosition(
            track.targetLon,
            track.targetLat,
            track.bearing,
            track.speed,
            cappedDt,
          );
          targetLon = dr.lon;
          targetLat = dr.lat;
        }
      }
    }

    const prev = prevPositions.get(v.id);
    if (!prev || approxDistanceKm(prev.lon, prev.lat, targetLon, targetLat) > SNAP_THRESHOLD_KM) {
      positions.set(v.id, { lon: targetLon, lat: targetLat, bearing: targetBearing });
      continue;
    }

    positions.set(v.id, {
      lon: prev.lon + (targetLon - prev.lon) * alphaPos,
      lat: prev.lat + (targetLat - prev.lat) * alphaPos,
      bearing: interpolateAngle(prev.bearing, targetBearing, alphaBearing),
    });
  }

  return { positions, vehiclesById };
}
