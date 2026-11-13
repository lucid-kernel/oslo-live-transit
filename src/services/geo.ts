import type { BoundingBox } from '../types/transit.ts';

/** `[longitude, latitude]` coordinate pair. */
export type LngLat = [number, number];

const KM_PER_DEG_LAT = 111;
const KM_PER_DEG_LON_OSLO = 55.6; // ~111 * cos(59.9 deg)

/** Decodes a Google-encoded polyline string into `[longitude, latitude]` pairs. */
export function decodePolyline(encoded: string): LngLat[] {
  const coords: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lon / 1e5, lat / 1e5]);
  }

  return coords;
}

/** Fast flat-earth distance approximation in kilometers (accurate around Oslo/Norway). */
export function approxDistKm(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const dLat = (lat2 - lat1) * KM_PER_DEG_LAT;
  const dLon = (lon2 - lon1) * KM_PER_DEG_LON_OSLO;
  return Math.hypot(dLat, dLon);
}

/** Computes initial compass bearing in degrees `[0, 360)` from point A to point B. */
export function computeBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const dLambda = (lon2 - lon1) * toRad;

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function isWithinBbox(lat: number, lon: number, bbox: BoundingBox): boolean {
  return (
    lat >= bbox.minLat &&
    lat <= bbox.maxLat &&
    lon >= bbox.minLon &&
    lon <= bbox.maxLon
  );
}

/** Finds the closest vertex in `coords` starting at `startFrom`. */
export function findNearestCoordIndex(
  coords: LngLat[],
  targetLon: number,
  targetLat: number,
  startFrom: number = 0,
): { idx: number; distKm: number } {
  let bestIdx = startFrom;
  let bestDist = Infinity;
  for (let i = startFrom; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    const km = approxDistKm(lon, lat, targetLon, targetLat);
    if (km < bestDist) {
      bestDist = km;
      bestIdx = i;
    }
  }
  return { idx: bestIdx, distKm: bestDist };
}

/** Interpolates position and bearing along a route polyline between two stops. */
export function interpolateAlongSegment(
  prevLat: number,
  prevLon: number,
  nextLat: number,
  nextLon: number,
  fraction: number,
  polyline: LngLat[] | null,
): { lat: number; lon: number; bearing: number } {
  const clamped = Math.max(0, Math.min(1, fraction));

  if (polyline && polyline.length >= 2) {
    const { idx: idx0 } = findNearestCoordIndex(polyline, prevLon, prevLat, 0);
    const { idx: idx1 } = findNearestCoordIndex(polyline, nextLon, nextLat, idx0);

    if (idx1 > idx0) {
      const cumDist: number[] = [0];
      let total = 0;
      for (let i = idx0; i < idx1; i++) {
        const [aLon, aLat] = polyline[i];
        const [bLon, bLat] = polyline[i + 1];
        total += approxDistKm(aLon, aLat, bLon, bLat);
        cumDist.push(total);
      }

      if (total > 1e-6) {
        const target = clamped * total;
        for (let i = 0; i < cumDist.length - 1; i++) {
          if (target <= cumDist[i + 1] || i === cumDist.length - 2) {
            const segLen = Math.max(1e-6, cumDist[i + 1] - cumDist[i]);
            const segFrac = (target - cumDist[i]) / segLen;
            const [aLon, aLat] = polyline[idx0 + i];
            const [bLon, bLat] = polyline[idx0 + i + 1];
            return {
              lat: aLat + (bLat - aLat) * segFrac,
              lon: aLon + (bLon - aLon) * segFrac,
              bearing: computeBearing(aLat, aLon, bLat, bLon),
            };
          }
        }
      }
    }
  }

  return {
    lat: prevLat + (nextLat - prevLat) * clamped,
    lon: prevLon + (nextLon - prevLon) * clamped,
    bearing: computeBearing(prevLat, prevLon, nextLat, nextLon),
  };
}

export function maxSegmentJumpKm(coords: LngLat[]): number {
  let maxKm = 0;
  for (let i = 1; i < coords.length; i++) {
    const km = approxDistKm(
      coords[i - 1][0],
      coords[i - 1][1],
      coords[i][0],
      coords[i][1],
    );
    if (km > maxKm) maxKm = km;
  }
  return maxKm;
}

function isNearAnyBranch(
  lon: number,
  lat: number,
  existingBranches: LngLat[][],
  thresholdKm: number,
): boolean {
  for (const branch of existingBranches) {
    if (findNearestCoordIndex(branch, lon, lat).distKm < thresholdKm) {
      return true;
    }
  }
  return false;
}

/**
 * Splits `coords` into contiguous sub-segments not already within `thresholdKm`
 * of `existingBranches`, preventing opposite-direction patterns from double-drawing.
 */
export function extractUncoveredSegments(
  coords: LngLat[],
  existingBranches: LngLat[][],
  thresholdKm: number = 0.18,
): LngLat[][] {
  if (coords.length < 2) return [];
  if (existingBranches.length === 0) return [coords];

  const covered = coords.map(([lon, lat]) =>
    isNearAnyBranch(lon, lat, existingBranches, thresholdKm),
  );

  const segments: LngLat[][] = [];
  let i = 0;
  while (i < coords.length) {
    if (covered[i]) {
      i++;
      continue;
    }
    const start = Math.max(0, i - 1);
    let j = i;
    while (j < coords.length && !covered[j]) j++;
    const end = Math.min(coords.length - 1, j);
    const seg = coords.slice(start, end + 1);

    if (seg.length >= 3) {
      let lenKm = 0;
      for (let k = 1; k < seg.length; k++) {
        lenKm += approxDistKm(seg[k - 1][0], seg[k - 1][1], seg[k][0], seg[k][1]);
      }
      if (lenKm > 0.25) {
        segments.push(seg);
      }
    }
    i = j + 1;
  }

  return segments;
}
