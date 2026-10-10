"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Circle, CircleMarker, Popup, GeoJSON, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useReports } from "@/lib/store/reports";
import type { GeoJsonObject } from "geojson";
import { isDemoBoundaries } from "@/lib/spatial/wards";
import L from "leaflet";
import { estimateImpact } from "@/lib/finance/impact";
import { weeklyBuckets } from "@/lib/early-warning/trends";

import { WardTag } from "@/lib/spatial/wards";
import type { FeatureCollection, Feature } from "geojson";
import { humanizeCategory } from "@/lib/utils/format";

async function fetchRoute(coords: { lat: number; lng: number }) {
  const res = await fetch("/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(coords)
  });
  if (!res.ok) throw new Error();
  return res.json();
}

function MapUpdater({ reports, selectedId, selectedWardName, wardsLayer }: { reports: { coordinates: { lat: number, lng: number } | null, report_id: string }[], selectedId: string | null, selectedWardName?: string | null, wardsLayer?: FeatureCollection | null }) {
  const map = useMap();
  useEffect(() => {
    if (selectedWardName && wardsLayer) {
      const feature = wardsLayer.features.find(f => {
        const name = (f.properties?.WARD_NAME || f.properties?.ward_name || "").toString();
        return name.toLowerCase() === selectedWardName.toLowerCase();
      });
      if (feature) {
        const layer = L.geoJSON(feature);
        map.fitBounds(layer.getBounds(), { maxZoom: 14, padding: [50, 50] });
        return;
      }
    }

    if (reports.length > 0 && !selectedId) {
      const coords = reports.filter(r => r.coordinates).map(r => [r.coordinates!.lat, r.coordinates!.lng] as [number, number]);
      if (coords.length > 0) {
        map.fitBounds(L.latLngBounds(coords), { padding: [50, 50] });
      }
    }
  }, [reports, map, selectedId, selectedWardName, wardsLayer]);

  useEffect(() => {
    if (selectedId) {
      const report = reports.find(r => r.report_id === selectedId);
      if (report && report.coordinates) {
        map.setView([report.coordinates.lat, report.coordinates.lng], 15);
      }
    }
  }, [selectedId, reports, map]);
  return null;
}

interface RouteData {
  geometry: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  distance_m: number;
  duration_s: number;
}

interface RoutesState {
  planned?: RouteData;
  bypass?: RouteData;
  hazmat?: RouteData;
  approximate?: boolean;
}

export function HazardMap({ selectedReportId, onSelectReport, auditResult, selectedWardName }: { selectedReportId: string | null, onSelectReport: (id: string) => void, auditResult?: any, selectedWardName?: string | null }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { reports } = useReports();
  const [wardsLayer, setWardsLayer] = useState<FeatureCollection | null>(null);
  const [showWards, setShowWards] = useState(false);
  const [showHotspots, setShowHotspots] = useState(false);
  const [routes, setRoutes] = useState<RoutesState | null>(null);

  useEffect(() => {
    fetch("/api/wards").then(r => r.json()).then((data: FeatureCollection) => setWardsLayer(data)).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    if (selectedReportId) {
      const report = reports.find(r => r.report_id === selectedReportId);
      if (report && report.coordinates && (report.action_required.includes("bypass") || report.action_required.includes("hazmat"))) {
        fetchRoute(report.coordinates).then(r => { if (active) setRoutes(r) }).catch(() => { if (active) setRoutes(null) });
      } else {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (active) setRoutes(null);
      }
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (active) setRoutes(null);
    }
    return () => { active = false; };
  }, [selectedReportId, reports]);


  if (reports.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-800 z-10 text-slate-400">
        No hazards reported yet
      </div>
    );
  }

  const selectedReport = reports.find(r => r.report_id === selectedReportId);
  const wardFeature = showWards && selectedReport && (selectedReport.ward as WardTag)?.status === "matched" && wardsLayer
    ? wardsLayer.features.find((f: Feature) => f.properties?.ward_id === (selectedReport.ward as Extract<WardTag, { status: "matched" }>).ward_id)
    : null;

  const buckets = showHotspots ? weeklyBuckets(reports) : {};

  const getWardStyle = (feature: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (showHotspots) {
      const name = (feature.properties?.WARD_NAME || feature.properties?.ward_name || "").toString();
      let wardKey = "Unknown";
      if (name.toLowerCase().includes("connaught") || name.toLowerCase().includes("cp")) wardKey = "Connaught Place";
      else if (name.toLowerCase().includes("lajpat")) wardKey = "Lajpat Nagar";
      else if (name.toLowerCase().includes("karol")) wardKey = "Karol Bagh";
      else wardKey = name;
      
      const thisWeekCount = buckets[wardKey] ? buckets[wardKey]!.counts[0] : 0;
      let fillColor = "#3388ff"; 
      if (thisWeekCount >= 4) fillColor = "#ef4444"; 
      else if (thisWeekCount >= 2) fillColor = "#f97316"; 
      else if (thisWeekCount >= 1) fillColor = "#eab308"; 
      else fillColor = "#22c55e"; 
      
      return { color: "#3388ff", weight: 1, fillColor, fillOpacity: 0.5 };
    }
    return { color: "#3388ff", weight: 1, fillOpacity: 0.1 };
  };

  return (
    <div className="relative w-full h-full" style={{ isolation: "isolate" }}>
      <MapContainer bounds={[[28.50,77.05],[28.72,77.32]]} maxZoom={12} style={{ height: "100%", width: "100%", zIndex: 1 }}>
        <TileLayer
          attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {wardsLayer && showWards && (
          <GeoJSON 
            data={wardsLayer} 
            style={getWardStyle}
            onEachFeature={(f, l) => {
              const name = f.properties?.WARD_NAME || f.properties?.ward_name || "Unknown";
              l.bindPopup(`<b>${name}</b>`);
            }}
          />
        )}

        {wardFeature && (
          <GeoJSON 
            key={(selectedReport?.ward as Extract<WardTag, { status: "matched" }>).ward_id}
            data={wardFeature} 
            style={{ color: "#ff3333", weight: 2, fillOpacity: 0.2 }}
          />
        )}

        {auditResult && auditResult.status === "success" && auditResult.centroid && (
          <Circle 
            center={[auditResult.centroid.lat, auditResult.centroid.lng]}
            radius={1500}
            pathOptions={{ color: 'purple', dashArray: '5, 10', fillOpacity: 0.1, weight: 2 }} 
          />
        )}

        {routes?.planned && (
          <GeoJSON key={`planned-${selectedReportId}`} data={routes.planned.geometry as GeoJsonObject} style={{ color: "#888", weight: 3, dashArray: "5, 10" }} />
        )}
        {routes?.bypass && (
          <GeoJSON key={`bypass-${selectedReportId}`} data={routes.bypass.geometry as GeoJsonObject} style={{ color: "#22c55e", weight: 4 }} />
        )}
        {routes?.hazmat && (
          <GeoJSON key={`hazmat-${selectedReportId}`} data={routes.hazmat.geometry as GeoJsonObject} style={{ color: "#f97316", weight: 4 }} />
        )}

        {reports.map(r => {
          if (!r.coordinates) return null;
          const color = r.severity_level >= 7 ? "#ef4444" : "#eab308";
          const markerRadius = r.severity_level >= 7 ? 9 : 6;
          return (
            <div key={r.report_id}>
              <Circle 
                center={[r.coordinates.lat, r.coordinates.lng]}
                radius={150}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.1, weight: 1 }}
                eventHandlers={{ click: () => onSelectReport(r.report_id) }}
              />
              <CircleMarker
                center={[r.coordinates.lat, r.coordinates.lng]}
                radius={markerRadius}
                pathOptions={{ color: "#fff", fillColor: color, fillOpacity: 0.9, weight: 1 }}
                eventHandlers={{ click: () => onSelectReport(r.report_id) }}
              >
                <Popup>
                  <div className="text-slate-900">
                    <h3 className="font-bold">{r.report_id}</h3>
                    <p className="text-sm">{humanizeCategory(r.hazard_category)}</p>
                    <p className="text-sm font-semibold">Sev: {r.severity_level}</p>
                    <p className="text-xs mt-1 text-slate-600">{r.raw_location}</p>
                    {(r.ward as WardTag)?.status === "matched" && (
                      <p className="text-xs font-medium text-blue-600 mt-1">{(r.ward as Extract<WardTag, { status: "matched" }>).ward_name}</p>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            </div>
          );
        })}

        <MapUpdater reports={reports} selectedId={selectedReportId} selectedWardName={selectedWardName} wardsLayer={wardsLayer} />
      </MapContainer>

      <div className="absolute top-4 right-4 z-[400] flex flex-col gap-2 items-stretch w-36">
        <button 
          onClick={() => setShowWards(!showWards)}
          className={`px-3 py-1.5 text-xs rounded shadow-md border ${showWards ? 'bg-blue-600 text-white border-blue-700' : 'bg-slate-900 text-slate-200 border-slate-700 hover:bg-slate-800'}`}
        >
          Toggle Wards
        </button>
        <button 
          onClick={() => {
            setShowHotspots(!showHotspots);
            if (!showHotspots) setShowWards(true);
          }}
          className={`px-3 py-1.5 text-xs rounded shadow-md border ${showHotspots ? 'bg-purple-600 text-white border-purple-700' : 'bg-slate-900 text-slate-200 border-slate-700 hover:bg-slate-800'}`}
        >
          Hotspot Shading
        </button>

        {showHotspots && (
          <div className="bg-slate-900/90 p-2 rounded shadow text-xs text-slate-200 border border-slate-700 flex flex-col gap-1 mt-1">
            <div className="font-bold border-b border-slate-700 pb-1 mb-1">This Week Reports</div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 bg-[#ef4444] opacity-50"></div> &ge; 4</div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 bg-[#f97316] opacity-50"></div> 2-3</div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 bg-[#eab308] opacity-50"></div> 1</div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 bg-[#22c55e] opacity-50"></div> 0</div>
          </div>
        )}
      </div>

      {isDemoBoundaries() && (
        <div className="absolute bottom-4 left-4 z-[400] bg-black/60 text-white/80 px-2 py-1 text-xs rounded">
          Demo ward boundaries
        </div>
      )}

      {routes && (
        <div className="absolute bottom-4 right-4 z-[400] bg-slate-900/90 p-3 rounded shadow text-xs text-slate-100 w-64 border border-slate-700">
          <h4 className="font-bold mb-2">Routing Plan {routes.approximate && <span className="bg-red-900/50 text-red-400 px-1 rounded ml-1 border border-red-800">Approx</span>}</h4>
          {routes.planned && (
            <div className="flex items-center gap-2 mb-1">
              <div className="w-3 h-0 border-t-2 border-dashed border-slate-400"></div>
              <span>Standard: {(routes.planned.distance_m / 1000).toFixed(1)}km, {Math.round(routes.planned.duration_s / 60)}min</span>
            </div>
          )}
          {routes.bypass && (
            <div className="flex items-center gap-2 mb-1">
              <div className="w-3 h-0 border-t-2 border-green-500"></div>
              <span>Bypass: {(routes.bypass.distance_m / 1000).toFixed(1)}km, {Math.round(routes.bypass.duration_s / 60)}min</span>
            </div>
          )}
          {routes.hazmat && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-0 border-t-2 border-orange-500"></div>
              <span>Hazmat: {(routes.hazmat.distance_m / 1000).toFixed(1)}km, {Math.round(routes.hazmat.duration_s / 60)}min</span>
            </div>
          )}
          {selectedReport && (
            <div className="mt-2 pt-2 border-t border-slate-700">
              <div title="See src/lib/finance/assumptions.ts" className="font-bold cursor-help border-b border-dashed border-slate-500 inline-block">Estimated Net Damage Prevented:</div>
              <div className="text-green-400 font-bold mt-1">₹{estimateImpact(selectedReport, routes).net_inr.toLocaleString()} <span className="text-[10px] text-slate-500 font-normal">(illustrative assumptions)</span></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
