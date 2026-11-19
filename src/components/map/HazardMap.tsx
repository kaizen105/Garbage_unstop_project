"use client";

import { useEffect, useState, useMemo } from "react";
import { MapContainer, TileLayer, Circle, CircleMarker, Popup, GeoJSON, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useReports, type Report as ClientReport } from "@/lib/store/reports";
import type { GeoJsonObject } from "geojson";
import { isDemoBoundaries } from "@/lib/spatial/wards";
import L from "leaflet";
import { estimateImpact } from "@/lib/finance/impact";
import { weeklyBuckets } from "@/lib/early-warning/trends";
import { WardTag } from "@/lib/spatial/wards";
import type { FeatureCollection } from "geojson";
import { humanizeCategory } from "@/lib/utils/format";
import { OSM_DARK_TILE_CONFIG } from "@/lib/mapTiles";
import { findWardFeature } from "@/lib/spatial/findWardFeature";
import { filterReports } from "@/lib/map/filterReports";
import { clusterReports } from "@/lib/map/clusterMarkers";
import { getDispatchBadge } from "@/lib/dispatch";

async function fetchRoute(coords: { lat: number; lng: number }) {
  const res = await fetch("/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(coords),
  });
  if (!res.ok) throw new Error();
  return res.json();
}

function MapUpdater({
  reports,
  selectedId,
  selectedWardName,
  wardsLayer,
}: {
  reports: { coordinates: { lat: number; lng: number } | null; report_id: string }[];
  selectedId: string | null;
  selectedWardName?: string | null;
  wardsLayer?: FeatureCollection | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (selectedWardName && wardsLayer) {
      const feature = wardsLayer.features.find((f) => {
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
      const coords = reports
        .filter((r) => r.coordinates)
        .map((r) => [r.coordinates!.lat, r.coordinates!.lng] as [number, number]);
      if (coords.length > 0) {
        map.fitBounds(L.latLngBounds(coords), { padding: [50, 50] });
      }
    }
  }, [reports, map, selectedId, selectedWardName, wardsLayer]);

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

interface MapResizerProps {
  isActive?: boolean;
}

interface FlyToReportProps {
  selectedReport?: { coordinates: { lat: number; lng: number } | null } | null;
  hasRoute?: boolean;
}

function FlyToReport({ selectedReport, hasRoute = false }: FlyToReportProps) {
  const map = useMap();

  useEffect(() => {
    if (selectedReport && selectedReport.coordinates && !hasRoute) {
      map.flyTo([selectedReport.coordinates.lat, selectedReport.coordinates.lng], 14, {
        duration: 1,
      });
    }
  }, [selectedReport, hasRoute, map]);

  return null;
}

function MapResizer({ isActive = true }: MapResizerProps) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [map]);

  useEffect(() => {
    if (!isActive) return;
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [map, isActive]);

  return null;
}

function ClusterZoomer({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lng], map.getZoom() + 2, { duration: 0.8 });
  }, [lat, lng, map]);
  return null;
}

export interface HazardMapProps {
  selectedReportId: string | null;
  onSelectReport: (id: string | null) => void;
  auditResult?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  selectedWardName?: string | null;
  isActive?: boolean;
  totalReportCount?: number;
  filterCategory?: string;
  filterMinSeverity?: number;
  filterAction?: string;
}

export function HazardMap({
  selectedReportId,
  onSelectReport,
  auditResult,
  selectedWardName,
  isActive = true,
  totalReportCount,
  filterCategory = "all",
  filterMinSeverity = 0,
  filterAction = "all",
}: HazardMapProps) {
  const { reports } = useReports();
  const [wardsLayer, setWardsLayer] = useState<FeatureCollection | null>(null);
  const [showWards, setShowWards] = useState(false);
  const [showHotspots, setShowHotspots] = useState(false);
  const [enableClustering, setEnableClustering] = useState(true);
  const [clusterTarget, setClusterTarget] = useState<{ lat: number; lng: number } | null>(null);
  const [routes, setRoutes] = useState<RoutesState | null>(null);
  const [fetchedReport, setFetchedReport] = useState<ClientReport | null>(null);
  const [sqlWardCounts, setSqlWardCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    fetch("/api/wards")
      .then((r) => r.json())
      .then((data: FeatureCollection) => setWardsLayer(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/early-warning")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data?.wardCounts) {
          setSqlWardCounts(data.wardCounts);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (selectedReportId) {
      const inList = reports.find((r) => r.report_id === selectedReportId);
      if (!inList) {
        fetch(`/api/reports/${selectedReportId}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (active && data?.report) {
              setFetchedReport(data.report);
            }
          })
          .catch(() => {});
      }
    }
    return () => {
      active = false;
    };
  }, [selectedReportId, reports]);

  const selectedReport =
    (selectedReportId ? reports.find((r) => r.report_id === selectedReportId) : null) ||
    (fetchedReport?.report_id === selectedReportId ? fetchedReport : null);

  useEffect(() => {
    let active = true;
    if (selectedReport) {
      if (
        selectedReport.coordinates &&
        (selectedReport.action_required.includes("bypass") ||
          selectedReport.action_required.includes("hazmat"))
      ) {
        fetchRoute(selectedReport.coordinates)
          .then((r) => {
            if (active) setRoutes(r);
          })
          .catch(() => {
            if (active) setRoutes(null);
          });
        return () => {
          active = false;
        };
      }
    }
    Promise.resolve().then(() => {
      if (active) setRoutes(null);
    });
    return () => {
      active = false;
    };
  }, [selectedReport]);

  const selectedWardTag = selectedReport ? (selectedReport.ward as WardTag | undefined) : undefined;
  const wardFeature = wardsLayer && selectedWardTag ? findWardFeature(wardsLayer.features, selectedWardTag) : null;
  const fallbackBuckets = showHotspots && !sqlWardCounts ? weeklyBuckets(reports) : {};

  const getWardStyle = (feature: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (showHotspots) {
      const name = (feature.properties?.WARD_NAME || feature.properties?.ward_name || "").toString();
      let wardKey = "Unknown";
      if (name.toLowerCase().includes("connaught") || name.toLowerCase().includes("cp")) wardKey = "Connaught Place";
      else if (name.toLowerCase().includes("lajpat")) wardKey = "Lajpat Nagar";
      else if (name.toLowerCase().includes("karol")) wardKey = "Karol Bagh";
      else wardKey = name;

      const thisWeekCount = sqlWardCounts
        ? sqlWardCounts[wardKey] ?? 0
        : fallbackBuckets[wardKey]
        ? fallbackBuckets[wardKey]!.counts[0]
        : 0;
      let fillColor = "#3388ff";
      if (thisWeekCount >= 4) fillColor = "#ef4444";
      else if (thisWeekCount >= 2) fillColor = "#f97316";
      else if (thisWeekCount >= 1) fillColor = "#eab308";
      else fillColor = "#22c55e";

      return { color: "#3388ff", weight: 1, fillColor, fillOpacity: 0.5 };
    }
    return { color: "#3388ff", weight: 1, fillOpacity: 0.1 };
  };

  // 1. Slice loaded reports
  const loadedSlice = reports.slice(0, 300);

  // 2. Filter loaded reports by category, severity, and action
  const displayReports = useMemo(() => {
    let filtered = filterReports(loadedSlice, {
      category: filterCategory,
      minSeverity: filterMinSeverity,
    });
    if (filterAction && filterAction !== "all") {
      filtered = filtered.filter((r) => {
        if (filterAction === "hazmat") return r.action_required.includes("hazmat");
        if (filterAction === "bypass") return r.action_required.includes("bypass") && !r.action_required.includes("hazmat");
        if (filterAction === "routine") return r.action_required === "routine_collection";
        return true;
      });
    }
    return filtered;
  }, [loadedSlice, filterCategory, filterMinSeverity, filterAction]);

  // 3. Cluster markers if enabled
  const { clusters, singles } = useMemo(() => {
    if (!enableClustering) {
      return { clusters: [], singles: displayReports };
    }
    return clusterReports(displayReports, 0.018);
  }, [displayReports, enableClustering]);

  if (reports.length === 0 && !selectedReport) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-10 text-slate-400">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 mx-auto border-2 border-slate-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs">Loading incident markers and ward boundaries...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full" style={{ isolation: "isolate" }}>
      <MapContainer
        bounds={[
          [28.5, 77.05],
          [28.72, 77.32],
        ]}
        maxZoom={14}
        style={{ height: "100%", width: "100%", zIndex: 1, backgroundColor: "#0f172a" }}
      >
        <MapResizer isActive={isActive} />
        <FlyToReport
          selectedReport={selectedReport}
          hasRoute={Boolean(routes?.planned || routes?.bypass || routes?.hazmat)}
        />
        {clusterTarget && <ClusterZoomer lat={clusterTarget.lat} lng={clusterTarget.lng} />}
        <TileLayer
          url={OSM_DARK_TILE_CONFIG.url}
          subdomains={OSM_DARK_TILE_CONFIG.subdomains}
          maxZoom={OSM_DARK_TILE_CONFIG.maxZoom}
          attribution={OSM_DARK_TILE_CONFIG.attribution}
          className={OSM_DARK_TILE_CONFIG.className}
        />

        {wardsLayer && showWards && (
          <GeoJSON
            data={wardsLayer}
            style={getWardStyle}
            onEachFeature={(f, l) => {
              const name = f.properties?.WARD_NAME || f.properties?.ward_name || "Unknown";
              l.bindPopup(`<b style="color:#0f172a">${name}</b>`);
            }}
          />
        )}

        {wardFeature && selectedWardTag?.status === "matched" && (
          <GeoJSON
            key={`highlight-${selectedWardTag.external_id || `${selectedWardTag.ward_id}-${selectedWardTag.ward_name || ""}`}`}
            data={wardFeature as GeoJsonObject}
            style={{ color: "#38bdf8", weight: 3, fillColor: "#38bdf8", fillOpacity: 0.25 }}
          />
        )}

        {auditResult && auditResult.status === "success" && auditResult.centroid && (
          <Circle
            center={[auditResult.centroid.lat, auditResult.centroid.lng]}
            radius={1500}
            pathOptions={{ color: "purple", dashArray: "5, 10", fillOpacity: 0.1, weight: 2 }}
          />
        )}

        {routes?.planned && (
          <GeoJSON
            key={`planned-${selectedReportId}`}
            data={routes.planned.geometry as GeoJsonObject}
            style={{ color: "#888", weight: 3, dashArray: "5, 10" }}
          />
        )}
        {routes?.bypass && (
          <GeoJSON
            key={`bypass-${selectedReportId}`}
            data={routes.bypass.geometry as GeoJsonObject}
            style={{ color: "#22c55e", weight: 4 }}
          />
        )}
        {routes?.hazmat && (
          <GeoJSON
            key={`hazmat-${selectedReportId}`}
            data={routes.hazmat.geometry as GeoJsonObject}
            style={{ color: "#f97316", weight: 4 }}
          />
        )}

        {/* Clustered Markers */}
        {clusters.map((cluster) => {
          const clusterColor = cluster.maxSeverity >= 7 ? "#ef4444" : cluster.maxSeverity >= 4 ? "#f59e0b" : "#3b82f6";
          const radius = Math.min(24, Math.max(14, 12 + Math.log2(cluster.count) * 4));
          return (
            <CircleMarker
              key={cluster.id}
              center={[cluster.lat, cluster.lng]}
              radius={radius}
              pathOptions={{
                color: "#ffffff",
                fillColor: clusterColor,
                fillOpacity: 0.85,
                weight: 2,
              }}
              eventHandlers={{
                click: () => {
                  setClusterTarget({ lat: cluster.lat, lng: cluster.lng });
                },
              }}
            >
              <Popup>
                <div className="p-1 text-slate-900 text-xs">
                  <div className="font-bold text-sm mb-1">{cluster.count} Incidents in Area</div>
                  <p className="text-slate-600">Dominant: {humanizeCategory(cluster.dominantCategory)}</p>
                  <p className="text-slate-600 font-semibold">Max Severity: {cluster.maxSeverity} / 10</p>
                  <div className="mt-2 text-[10px] text-blue-600 font-medium cursor-pointer">Click to zoom into cluster</div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {/* Individual Markers */}
        {singles.map((r) => {
          if (!r.coordinates) return null;
          const isSelected = selectedReportId === r.report_id;
          const markerColor = r.severity_level >= 7 ? "#ef4444" : r.severity_level >= 4 ? "#f59e0b" : "#3b82f6";
          const markerRadius = isSelected ? 11 : r.severity_level >= 7 ? 8 : 6;

          return (
            <div key={r.report_id}>
              {isSelected && (
                <Circle
                  center={[r.coordinates.lat, r.coordinates.lng]}
                  radius={200}
                  pathOptions={{ color: "#38bdf8", fillColor: "#38bdf8", fillOpacity: 0.2, weight: 2 }}
                />
              )}
              <CircleMarker
                center={[r.coordinates.lat, r.coordinates.lng]}
                radius={markerRadius}
                pathOptions={{
                  color: isSelected ? "#38bdf8" : "#ffffff",
                  fillColor: markerColor,
                  fillOpacity: isSelected ? 1 : 0.85,
                  weight: isSelected ? 3 : 1.5,
                }}
                eventHandlers={{
                  click: () => onSelectReport(r.report_id),
                }}
              >
                <Popup>
                  <div className="text-slate-900 p-1 min-w-[180px]">
                    <div className="flex items-center justify-between border-b pb-1 mb-1.5">
                      <span className="font-mono text-xs font-bold">{r.report_id}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded text-white ${r.severity_level >= 7 ? "bg-red-600" : "bg-amber-600"}`}>
                        Sev {r.severity_level}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-800">{humanizeCategory(r.hazard_category)}</p>
                    <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">{r.raw_location}</p>
                    {(r.ward as WardTag)?.status === "matched" && (
                      <p className="text-[11px] font-medium text-blue-600 mt-1">
                        {(r.ward as Extract<WardTag, { status: "matched" }>).ward_name}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelectReport(r.report_id)}
                      className="mt-2 w-full py-1 bg-slate-900 hover:bg-slate-800 text-white rounded text-[10px] font-medium transition-colors"
                    >
                      Inspect Incident Details
                    </button>
                  </div>
                </Popup>
              </CircleMarker>
            </div>
          );
        })}

        <MapUpdater
          reports={displayReports}
          selectedId={selectedReportId}
          selectedWardName={selectedWardName}
          wardsLayer={wardsLayer}
        />
      </MapContainer>

      {/* Prominent Map Slice Indicator Badge */}
      <div className="absolute top-3 left-3 z-[400] bg-slate-950/90 backdrop-blur border border-slate-700/80 text-slate-200 text-xs px-3.5 py-2.5 rounded-lg shadow-xl max-w-xs space-y-1">
        <div className="font-semibold text-slate-100 flex items-center gap-1.5 text-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>
            Displaying {displayReports.length} of {loadedSlice.length} loaded markers
          </span>
          {totalReportCount && totalReportCount > reports.length && (
            <span className="text-slate-400 font-normal">({totalReportCount} total in DB)</span>
          )}
        </div>
        <div className="text-[10px] text-amber-300/90 font-medium">
          Filters operate strictly on loaded markers
        </div>
      </div>

      {/* Map Control Toolbar */}
      <div className="absolute top-3 right-3 z-[400] flex flex-col gap-1.5 items-stretch w-36">
        <button
          type="button"
          onClick={() => setShowWards(!showWards)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md shadow-md border transition-colors flex items-center justify-between ${
            showWards
              ? "bg-blue-600 text-white border-blue-500 shadow-blue-900/30"
              : "bg-slate-900/90 backdrop-blur text-slate-200 border-slate-700 hover:bg-slate-800"
          }`}
        >
          <span>Wards Layer</span>
          <span className="text-[10px] font-mono opacity-80">{showWards ? "ON" : "OFF"}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setShowHotspots(!showHotspots);
            if (!showHotspots) setShowWards(true);
          }}
          className={`px-3 py-1.5 text-xs font-medium rounded-md shadow-md border transition-colors flex items-center justify-between ${
            showHotspots
              ? "bg-purple-600 text-white border-purple-500 shadow-purple-900/30"
              : "bg-slate-900/90 backdrop-blur text-slate-200 border-slate-700 hover:bg-slate-800"
          }`}
        >
          <span>Hotspot Shading</span>
          <span className="text-[10px] font-mono opacity-80">{showHotspots ? "ON" : "OFF"}</span>
        </button>

        <button
          type="button"
          onClick={() => setEnableClustering(!enableClustering)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md shadow-md border transition-colors flex items-center justify-between ${
            enableClustering
              ? "bg-emerald-600 text-white border-emerald-500 shadow-emerald-900/30"
              : "bg-slate-900/90 backdrop-blur text-slate-200 border-slate-700 hover:bg-slate-800"
          }`}
        >
          <span>Clustering</span>
          <span className="text-[10px] font-mono opacity-80">{enableClustering ? "ON" : "OFF"}</span>
        </button>

        {showHotspots && (
          <div className="bg-slate-950/95 backdrop-blur p-2.5 rounded-md shadow-lg text-[11px] text-slate-300 border border-slate-800 flex flex-col gap-1 mt-1">
            <div className="font-bold border-b border-slate-800 pb-1 mb-0.5 text-slate-200">Weekly Incidents</div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-[#ef4444] rounded-sm"></div> &ge; 4 incidents
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-[#f97316] rounded-sm"></div> 2 to 3 incidents
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-[#eab308] rounded-sm"></div> 1 incident
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-[#22c55e] rounded-sm"></div> 0 incidents
            </div>
          </div>
        )}
      </div>

      {/* Demo Boundaries Badge */}
      {isDemoBoundaries() && (
        <div className="absolute bottom-3 left-3 z-[400] bg-black/75 backdrop-blur text-white/80 px-2.5 py-1 text-[10px] font-mono rounded border border-slate-800">
          Demo ward boundaries (DataMeet 290)
        </div>
      )}

      {/* Selected Incident Inspection Drawer */}
      {selectedReport && (
        <div className="absolute bottom-3 right-3 z-[450] bg-slate-950/95 backdrop-blur p-4 rounded-xl shadow-2xl text-xs text-slate-100 w-80 max-w-[calc(100vw-2rem)] border border-slate-700/80 space-y-3">
          <div className="flex items-start justify-between border-b border-slate-800 pb-2">
            <div>
              <span className="text-[10px] font-mono text-slate-400">INCIDENT DOSSIER</span>
              <h4 className="font-bold text-sm text-slate-100">{selectedReport.report_id}</h4>
            </div>
            <button
              type="button"
              onClick={() => onSelectReport(null)}
              className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close incident inspection"
            >
              x
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Category:</span>
              <span className="font-semibold text-slate-200">{humanizeCategory(selectedReport.hazard_category)}</span>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Severity:</span>
              <div className="flex items-center gap-1.5">
                <div className="flex gap-0.5">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <span
                      key={i}
                      className={`w-1.5 h-3 rounded-xs ${
                        i < selectedReport.severity_level
                          ? selectedReport.severity_level >= 7
                            ? "bg-red-500"
                            : "bg-amber-400"
                          : "bg-slate-800"
                      }`}
                    />
                  ))}
                </div>
                <span className="font-bold">{selectedReport.severity_level}/10</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Dispatch Action:</span>
              {(() => {
                const badge = getDispatchBadge(selectedReport.action_required);
                return (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-semibold tracking-wide border ${
                      badge.tone === "danger"
                        ? "bg-red-950/80 border-red-800 text-red-300"
                        : badge.tone === "warning"
                        ? "bg-amber-950/80 border-amber-800 text-amber-300"
                        : "bg-slate-800 border-slate-700 text-slate-300"
                    }`}
                  >
                    {badge.label}
                  </span>
                );
              })()}
            </div>

            <div className="text-[11px] pt-1">
              <span className="text-slate-400 block mb-0.5">Reported Location:</span>
              <p className="text-slate-300 bg-slate-900/80 p-2 rounded border border-slate-800 truncate">
                {selectedReport.raw_location}
              </p>
            </div>

            {(selectedReport.ward as WardTag)?.status === "matched" && (
              <div className="text-[11px]">
                <span className="text-slate-400 block mb-0.5">Tagged MCD Ward:</span>
                <span className="text-cyan-300 font-medium">
                  {(selectedReport.ward as Extract<WardTag, { status: "matched" }>).ward_name}
                </span>
              </div>
            )}
          </div>

          {/* Routing Plan Details */}
          {routes && (
            <div className="pt-2 border-t border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
                <span>Fleet Routing Solution</span>
                {routes.approximate && (
                  <span className="text-[9px] bg-red-950 text-red-400 border border-red-800 px-1.5 py-0.2 rounded font-mono">
                    Approx
                  </span>
                )}
              </div>
              {routes.planned && (
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-0 border-t border-dashed border-slate-400"></span> Standard Path:
                  </span>
                  <span className="font-mono text-slate-300">
                    {(routes.planned.distance_m / 1000).toFixed(1)}km ({Math.round(routes.planned.duration_s / 60)}min)
                  </span>
                </div>
              )}
              {routes.bypass && (
                <div className="flex items-center justify-between text-[10px] text-emerald-400">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-0 border-t-2 border-emerald-500"></span> Hazard Bypass:
                  </span>
                  <span className="font-mono">
                    {(routes.bypass.distance_m / 1000).toFixed(1)}km ({Math.round(routes.bypass.duration_s / 60)}min)
                  </span>
                </div>
              )}
              {routes.hazmat && (
                <div className="flex items-center justify-between text-[10px] text-orange-400">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-0 border-t-2 border-orange-500"></span> Hazmat Dispatch:
                  </span>
                  <span className="font-mono">
                    {(routes.hazmat.distance_m / 1000).toFixed(1)}km ({Math.round(routes.hazmat.duration_s / 60)}min)
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Damage Prevented Metric */}
          <div className="pt-2 border-t border-slate-800 text-[11px]">
            <span className="text-slate-400 block">Est. Prevented Damage:</span>
            <span className="text-emerald-400 font-bold text-sm">
              ₹{estimateImpact(selectedReport, routes).net_inr.toLocaleString()}
            </span>
            <span className="text-[9px] text-slate-500 ml-1.5">(illustrative assumption)</span>
          </div>
        </div>
      )}
    </div>
  );
}
