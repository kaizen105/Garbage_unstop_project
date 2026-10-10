"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Circle, Popup, GeoJSON, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useReports } from "@/lib/store/reports";
import { isDemoBoundaries } from "@/lib/spatial/wards";
import L from "leaflet";

import { WardTag } from "@/lib/spatial/wards";
import type { FeatureCollection, Feature } from "geojson";

async function fetchRoute(coords: { lat: number; lng: number }) {
  const res = await fetch("/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(coords)
  });
  if (!res.ok) throw new Error();
  return res.json();
}

function MapUpdater({ reports, selectedId }: { reports: { coordinates: { lat: number, lng: number } | null, report_id: string }[], selectedId: string | null }) {
  const map = useMap();
  useEffect(() => {
    if (reports.length > 0 && !selectedId) {
      const coords = reports.filter(r => r.coordinates).map(r => [r.coordinates!.lat, r.coordinates!.lng] as [number, number]);
      if (coords.length > 0) {
        map.fitBounds(L.latLngBounds(coords), { padding: [50, 50] });
      }
    }
  }, [reports, map, selectedId]);

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

export function HazardMap({ selectedReportId, onSelectReport }: { selectedReportId: string | null, onSelectReport: (id: string) => void }) {
  const { reports } = useReports();
  const [wardsLayer, setWardsLayer] = useState<FeatureCollection | null>(null);
  const [showWards, setShowWards] = useState(false);
  const [routes, setRoutes] = useState<Record<string, unknown> | null>(null);

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
        if (active) setRoutes(null);
      }
    } else {
      if (active) setRoutes(null);
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <div className="relative w-full h-full" style={{ isolation: "isolate" }}>
      <MapContainer center={[28.6139, 77.2090]} zoom={11} style={{ height: "100%", width: "100%", zIndex: 1 }}>
        <TileLayer
          attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {wardsLayer && showWards && (
          <GeoJSON 
            data={wardsLayer} 
            style={{ color: "#3388ff", weight: 1, fillOpacity: 0.1 }}
          />
        )}

        {wardFeature && (
          <GeoJSON 
            key={(selectedReport?.ward as Extract<WardTag, { status: "matched" }>).ward_id}
            data={wardFeature} 
            style={{ color: "#ff3333", weight: 2, fillOpacity: 0.2 }}
          />
        )}

        {routes?.planned && (
          <GeoJSON key={`planned-${selectedReportId}`} data={routes.planned.geometry} style={{ color: "#888", weight: 3, dashArray: "5, 10" }} />
        )}
        {routes?.bypass && (
          <GeoJSON key={`bypass-${selectedReportId}`} data={routes.bypass.geometry} style={{ color: "#22c55e", weight: 4 }} />
        )}
        {routes?.hazmat && (
          <GeoJSON key={`hazmat-${selectedReportId}`} data={routes.hazmat.geometry} style={{ color: "#f97316", weight: 4 }} />
        )}

        {reports.map(r => {
          if (!r.coordinates) return null;
          const color = r.severity_level >= 7 ? "#ef4444" : "#eab308";
          return (
            <Circle 
              key={r.report_id}
              center={[r.coordinates.lat, r.coordinates.lng]}
              radius={150}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.5 }}
              eventHandlers={{ click: () => onSelectReport(r.report_id) }}
            >
              <Popup>
                <div className="text-slate-900">
                  <h3 className="font-bold">{r.report_id}</h3>
                  <p className="text-sm">{r.hazard_category}</p>
                  <p className="text-sm font-semibold">Sev: {r.severity_level}</p>
                  <p className="text-xs mt-1 text-slate-600">{r.raw_location}</p>
                  {(r.ward as WardTag)?.status === "matched" && (
                    <p className="text-xs font-medium text-blue-600 mt-1">{(r.ward as Extract<WardTag, { status: "matched" }>).ward_name}</p>
                  )}
                </div>
              </Popup>
            </Circle>
          );
        })}

        <MapUpdater reports={reports} selectedId={selectedReportId} />
      </MapContainer>

      <div className="absolute top-4 right-4 z-[400] flex gap-2">
        <button 
          onClick={() => setShowWards(!showWards)}
          className={`px-3 py-1.5 text-xs rounded shadow-md border ${showWards ? 'bg-blue-600 text-white border-blue-700' : 'bg-slate-900 text-slate-200 border-slate-700 hover:bg-slate-800'}`}
        >
          Toggle Wards
        </button>
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
        </div>
      )}
    </div>
  );
}
