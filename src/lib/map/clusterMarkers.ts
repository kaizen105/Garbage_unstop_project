import type { Report } from "@/lib/store/reports";

export interface MarkerCluster {
  id: string;
  lat: number;
  lng: number;
  count: number;
  reports: Report[];
  maxSeverity: number;
  dominantCategory: string;
}

export interface ClusteredMarkersResult {
  clusters: MarkerCluster[];
  singles: Report[];
}

/**
 * Pure function to cluster nearby reports on a geographic grid.
 * Grid size in degrees (~0.015 degrees is roughly 1.5 km in Delhi).
 * Zero external dependencies.
 */
export function clusterReports(
  reports: Report[],
  gridSize: number = 0.018
): ClusteredMarkersResult {
  const validReports = reports.filter((r) => {
    if (!r.coordinates) return false;
    const { lat, lng } = r.coordinates;
    return (
      typeof lat === "number" &&
      typeof lng === "number" &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    );
  });

  const grid = new Map<string, Report[]>();

  for (const report of validReports) {
    const lat = report.coordinates!.lat;
    const lng = report.coordinates!.lng;

    const cellX = Math.round(lat / gridSize);
    const cellY = Math.round(lng / gridSize);
    const key = `${cellX}_${cellY}`;

    const cell = grid.get(key);
    if (cell) {
      cell.push(report);
    } else {
      grid.set(key, [report]);
    }
  }

  const clusters: MarkerCluster[] = [];
  const singles: Report[] = [];

  for (const [key, cellReports] of grid.entries()) {
    if (cellReports.length === 1) {
      singles.push(cellReports[0]!);
    } else if (cellReports.length > 1) {
      let sumLat = 0;
      let sumLng = 0;
      let maxSev = 0;
      const categoryCounts: Record<string, number> = {};

      for (const r of cellReports) {
        sumLat += r.coordinates!.lat;
        sumLng += r.coordinates!.lng;
        if (r.severity_level > maxSev) maxSev = r.severity_level;
        const cat = r.hazard_category || "unknown";
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      }

      let dominantCategory = "unknown";
      let highestCatCount = 0;
      for (const cat in categoryCounts) {
        if (categoryCounts[cat]! > highestCatCount) {
          highestCatCount = categoryCounts[cat]!;
          dominantCategory = cat;
        }
      }

      clusters.push({
        id: `cluster_${key}`,
        lat: sumLat / cellReports.length,
        lng: sumLng / cellReports.length,
        count: cellReports.length,
        reports: cellReports,
        maxSeverity: maxSev,
        dominantCategory,
      });
    }
  }

  return { clusters, singles };
}
