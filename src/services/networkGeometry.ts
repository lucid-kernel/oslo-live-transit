import type { BoundingBox, NetworkData, NetworkRoute, NetworkStop, TransitMode } from '../types/transit.ts';
import { mapVehicleMode, readLineColor, type LinePresentation } from './enturClient.ts';
import { classifyRailCategory } from './railCategory.ts';
import {
  approxDistKm,
  decodePolyline,
  extractUncoveredSegments,
  findNearestCoordIndex,
  isWithinBbox,
  maxSegmentJumpKm,
  type LngLat,
} from './geo.ts';

export interface RawNetworkLine {
  presentation?: LinePresentation | null;
  id: string;
  publicCode?: string | null;
  name?: string | null;
  transportMode?: string | null;
  authority?: { name?: string | null } | null;
  journeyPatterns?: Array<{
    id?: string | null;
    name?: string | null;
    pointsOnLink?: { points?: string | null } | null;
  }> | null;
  quays?: Array<{
    stopPlace?: {
      id?: string | null;
      name?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    } | null;
  }> | null;
}

/**
 * Replaces coarse station-to-station rail segments (e.g. Flytoget) with
 * matching curved track sub-polylines from detailed Vy regional rail routes.
 */
function refineCoarseRailRoutes(routes: NetworkRoute[]): void {
  const detailed = routes.filter(
    (r) => r.coordinates.length >= 100 && maxSegmentJumpKm(r.coordinates) < 6.0,
  );
  if (detailed.length === 0) return;

  for (const route of routes) {
    if (route.coordinates.length < 2 || maxSegmentJumpKm(route.coordinates) <= 6.0) {
      continue;
    }

    const refined: LngLat[] = [];
    for (let i = 0; i < route.coordinates.length - 1; i++) {
      const [lonA, latA] = route.coordinates[i];
      const [lonB, latB] = route.coordinates[i + 1];
      const segKm = approxDistKm(lonA, latA, lonB, latB);

      let spliced: LngLat[] | null = null;
      if (segKm > 4.0) {
        let bestSliceLen = Infinity;
        for (const donor of detailed) {
          const hitA = findNearestCoordIndex(donor.coordinates, lonA, latA);
          const hitB = findNearestCoordIndex(donor.coordinates, lonB, latB);
          if (hitA.distKm < 0.6 && hitB.distKm < 0.6 && hitA.idx !== hitB.idx) {
            const slice =
              hitA.idx < hitB.idx
                ? donor.coordinates.slice(hitA.idx, hitB.idx + 1)
                : donor.coordinates.slice(hitB.idx, hitA.idx + 1).reverse();
            if (slice.length < bestSliceLen) {
              bestSliceLen = slice.length;
              spliced = slice;
            }
          }
        }
      }

      if (spliced && spliced.length >= 2) {
        if (refined.length > 0) refined.pop();
        refined.push(...spliced);
      } else {
        if (refined.length === 0) refined.push([lonA, latA]);
        refined.push([lonB, latB]);
      }
    }

    if (refined.length > route.coordinates.length) {
      route.coordinates = refined;
    }
  }
}

export function buildNetworkData(
  rawLines: RawNetworkLine[],
  mode: TransitMode,
  filterBbox?: BoundingBox,
): NetworkData {
  const stopMap = new Map<string, NetworkStop>();
  const routes: NetworkRoute[] = [];

  for (const line of rawLines) {
    const lineCode = line.publicCode || line.name || line.id;
    const lineName = line.name || lineCode;
    const lineMode = line.transportMode ? mapVehicleMode(line.transportMode) : mode;

    const lineStopsMap = new Map<string, NetworkStop>();
    for (const q of line.quays ?? []) {
      const sp = q.stopPlace;
      if (
        !sp?.id ||
        typeof sp.latitude !== 'number' ||
        typeof sp.longitude !== 'number'
      ) {
        continue;
      }
      if (filterBbox && !isWithinBbox(sp.latitude, sp.longitude, filterBbox)) {
        continue;
      }

      if (!lineStopsMap.has(sp.id)) {
        lineStopsMap.set(sp.id, {
          id: sp.id,
          name: sp.name ?? sp.id,
          lat: sp.latitude,
          lon: sp.longitude,
          mode: lineMode,
          lines: [lineCode],
        });
      }

      const existingGlobal = stopMap.get(sp.id);
      if (existingGlobal) {
        if (existingGlobal.lines && !existingGlobal.lines.includes(lineCode)) {
          existingGlobal.lines.push(lineCode);
        }
      } else {
        stopMap.set(sp.id, {
          id: sp.id,
          name: sp.name ?? sp.id,
          lat: sp.latitude,
          lon: sp.longitude,
          mode: lineMode,
          lines: [lineCode],
        });
      }
    }

    const operatorName =
      line.authority?.name ?? (lineMode === 'train' ? undefined : 'Ruter');
    const lineStops = Array.from(lineStopsMap.values());

    if (lineMode === 'metro') {
      const allPatterns = [...(line.journeyPatterns ?? [])]
        .filter((jp) => (jp.pointsOnLink?.points?.length ?? 0) > 0)
        .sort(
          (a, b) =>
            (b.pointsOnLink?.points?.length ?? 0) -
            (a.pointsOnLink?.points?.length ?? 0),
        );

      // Exclude rare depot/positioning patterns (e.g. Line 2 -> Mortensrud/Ryen) by keeping
      // patterns whose endpoints match the line's official "TermA - TermB" name when available.
      const termini = line.name?.split(' - ').map((s) => s.trim()) ?? [];
      const primaryNames =
        termini.length === 2
          ? new Set([`${termini[0]}-${termini[1]}`, `${termini[1]}-${termini[0]}`])
          : null;
      const primaryPatterns = primaryNames
        ? allPatterns.filter((jp) => jp.name && primaryNames.has(jp.name.trim()))
        : [];
      const patterns = primaryPatterns.length > 0 ? primaryPatterns : allPatterns;

      const acceptedBranches: LngLat[][] = [];
      for (const jp of patterns) {
        const decoded = decodePolyline(jp.pointsOnLink?.points ?? '');
        const coords = filterBbox
          ? decoded.filter(([lon, lat]) => isWithinBbox(lat, lon, filterBbox))
          : decoded;

        const novelSegments = extractUncoveredSegments(coords, acceptedBranches);
        for (let sIdx = 0; sIdx < novelSegments.length; sIdx++) {
          const seg = novelSegments[sIdx];
          acceptedBranches.push(seg);

          routes.push({
            id: jp.id
              ? `${line.id}:${jp.id}:${sIdx}`
              : `${line.id}:${acceptedBranches.length}`,
            lineCode,
            lineName: jp.name ? `${lineCode} ${jp.name}` : lineName,
            mode: lineMode,
            operator: operatorName,
            operatorName,
            coordinates: seg,
            stops: lineStops,
          });
        }
      }
      continue;
    }

    let bestEncoded = '';
    for (const jp of line.journeyPatterns ?? []) {
      const pts = jp.pointsOnLink?.points ?? '';
      if (pts.length > bestEncoded.length) bestEncoded = pts;
    }

    let coordinates: LngLat[] = [];
    if (bestEncoded) {
      const decoded = decodePolyline(bestEncoded);
      coordinates = filterBbox
        ? decoded.filter(([lon, lat]) => isWithinBbox(lat, lon, filterBbox))
        : decoded;
    }

    routes.push({
      id: line.id,
      lineCode,
      lineColor: readLineColor(line.presentation),
      lineName,
      mode: lineMode,
      operator: operatorName,
      operatorName,
      railCategory: lineMode === 'train' ? classifyRailCategory(lineCode) : undefined,
      coordinates,
      stops: lineStops,
    });
  }

  if (mode === 'train') {
    refineCoarseRailRoutes(routes);
  }

  return {
    routes,
    stops: Array.from(stopMap.values()),
  };
}
