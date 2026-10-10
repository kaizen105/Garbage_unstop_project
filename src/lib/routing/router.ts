import * as turf from "@turf/turf";
import { z } from "zod";

const depotLngLat = [77.1891, 28.6448] as [number, number]; // Karol Bagh area depot
const transferLngLat = [77.2790, 28.5524] as [number, number]; // Okhla transfer station
const hazmat1LngLat = [77.2167, 28.6315] as [number, number]; // CP hazmat depot
const hazmat2LngLat = [77.0583, 28.5523] as [number, number]; // Dwarka hazmat depot

const OsrmRouteSchema = z.object({
  routes: z.array(z.object({
    geometry: z.any(),
    distance: z.number(),
    duration: z.number()
  }))
});

async function fetchOsrm(waypoints: [number, number][]) {
  const coordsStr = waypoints.map(wp => `${wp[0]},${wp[1]}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 8000);

  try {
    let res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      res = await fetch(url, { signal: controller.signal });
    }
    if (!res.ok) throw new Error("OSRM failed");
    const json = await res.json();
    return OsrmRouteSchema.parse(json);
  } finally {
    clearTimeout(id);
  }
}

export async function fetchRoute({ lat, lng }: { lat: number; lng: number }) {
  const hazardLngLat = [lng, lat] as [number, number];

  let planned, bypass, hazmat;
  
  try {
    const plannedData = await fetchOsrm([depotLngLat, hazardLngLat, transferLngLat]);
    planned = {
      geometry: plannedData.routes[0].geometry,
      distance_m: plannedData.routes[0].distance,
      duration_s: plannedData.routes[0].duration
    };

    let detourPoint = turf.destination(turf.point(hazardLngLat), 0.4, 90).geometry.coordinates as [number, number];
    let bypassData = await fetchOsrm([depotLngLat, detourPoint, transferLngLat]);
    
    let dist = turf.pointToLineDistance(turf.point(hazardLngLat), bypassData.routes[0].geometry as turf.helpers.LineString, { units: 'kilometers' });
    if (dist < 0.2) {
      detourPoint = turf.destination(turf.point(hazardLngLat), 0.4, -90).geometry.coordinates as [number, number];
      bypassData = await fetchOsrm([depotLngLat, detourPoint, transferLngLat]);
    }
    
    bypass = {
      geometry: bypassData.routes[0].geometry,
      distance_m: bypassData.routes[0].distance,
      duration_s: bypassData.routes[0].duration
    };

    const dist1 = turf.distance(turf.point(hazardLngLat), turf.point(hazmat1LngLat));
    const dist2 = turf.distance(turf.point(hazardLngLat), turf.point(hazmat2LngLat));
    const nearestHazmat = dist1 < dist2 ? hazmat1LngLat : hazmat2LngLat;

    const hazmatData = await fetchOsrm([nearestHazmat, hazardLngLat]);
    hazmat = {
      geometry: hazmatData.routes[0].geometry,
      distance_m: hazmatData.routes[0].distance,
      duration_s: hazmatData.routes[0].duration
    };

    return { planned, bypass, hazmat, approximate: false };
  } catch {
    const detourPoint = turf.destination(turf.point(hazardLngLat), 0.4, 90).geometry.coordinates as [number, number];
    const nearestHazmat = turf.distance(turf.point(hazardLngLat), turf.point(hazmat1LngLat)) < turf.distance(turf.point(hazardLngLat), turf.point(hazmat2LngLat)) ? hazmat1LngLat : hazmat2LngLat;
    return {
      planned: { geometry: { type: "LineString", coordinates: [depotLngLat, hazardLngLat, transferLngLat] }, distance_m: 0, duration_s: 0 },
      bypass: { geometry: { type: "LineString", coordinates: [depotLngLat, detourPoint, transferLngLat] }, distance_m: 0, duration_s: 0 },
      hazmat: { geometry: { type: "LineString", coordinates: [nearestHazmat, hazardLngLat] }, distance_m: 0, duration_s: 0 },
      approximate: true
    };
  }
}
