"use client";

import { VoiceReporter } from "@/components/voice/VoiceReporter";
import { useReports } from "@/lib/store/reports";
import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import { EarlyWarningPanel } from "@/components/dashboard/EarlyWarningPanel";
import { MitigationPlanPanel } from "@/components/dashboard/MitigationPlanPanel";
import { estimateImpact } from "@/lib/finance/impact";
import { humanizeCategory } from "@/lib/utils/format";
import { getDispatchBadge } from "@/lib/dispatch";
import { DATA_DISCLOSURE_TEXT } from "@/lib/dataDisclosure";
import { ALL_HAZARD_CATEGORIES, getCategoryLabel } from "@/lib/categories";

const HazardMap = dynamic(() => import("@/components/map/HazardMap").then((m) => m.HazardMap), { ssr: false });

export function DashboardClient() {
  const { reports, appendReports, loadDemoData, resetView, isResetting } = useReports();
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [mapFilterCategory, setMapFilterCategory] = useState<string>("all");
  const [mapFilterMinSeverity, setMapFilterMinSeverity] = useState<number>(0);
  const [mapFilterAction, setMapFilterAction] = useState<string>("all");
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= 768;
    }
    return true;
  });

  const [stats, setStats] = useState<{
    total: number;
    high_severity_count: number;
    average_severity: number;
    hazmat_count: number;
    estimated_prevented: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchStats() {
      try {
        const res = await fetch("/api/stats");
        if (res.ok && active) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err: unknown) {
        console.warn("Failed to load /api/stats:", err);
      }
    }
    fetchStats();
    return () => {
      active = false;
    };
  }, []);

  const total = stats ? stats.total : reports.length;
  const highSev = stats ? stats.high_severity_count : reports.filter((r) => r.severity_level >= 7).length;
  const avgSev = stats
    ? stats.average_severity.toFixed(1)
    : (total > 0 ? (reports.reduce((a, b) => a + b.severity_level, 0) / total).toFixed(1) : "0.0");
  const hazmat = stats ? stats.hazmat_count : reports.filter((r) => r.action_required.includes("hazmat")).length;
  const totalNetInr = stats ? stats.estimated_prevented : reports.reduce((acc, r) => acc + estimateImpact(r).prevented_inr, 0);

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const handleLoadMore = async () => {
    if (reports.length === 0 || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const lastReport = reports[reports.length - 1];
      const cursor = lastReport ? lastReport.report_id : "";
      const res = await fetch(`/api/reports?cursor=${cursor}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        if (data.reports && data.reports.length > 0) {
          appendReports(data.reports);
          if (!data.nextCursor || data.reports.length < 50) {
            setHasMore(false);
          }
        } else {
          setHasMore(false);
        }
      }
    } catch (err: unknown) {
      console.warn("Failed to load more reports:", err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const [auditResult, setAuditResult] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [isAuditing, setIsAuditing] = useState(false);
  const [activeTab, setActiveTab] = useState<"map" | "early_warning" | "mitigation">(() => {
    if (typeof window !== "undefined") {
      const tab = new URLSearchParams(window.location.search).get("tab");
      if (tab === "early_warning" || tab === "early-warning") return "early_warning";
      if (tab === "mitigation") return "mitigation";
    }
    return "map";
  });

  useEffect(() => {
    const handlePopState = () => {
      const tab = new URLSearchParams(window.location.search).get("tab");
      if (tab === "early_warning" || tab === "early-warning") {
        setActiveTab("early_warning");
      } else if (tab === "mitigation") {
        setActiveTab("mitigation");
      } else {
        setActiveTab("map");
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  const [selectedWardName, setSelectedWardName] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<{
    reachable: boolean;
    wardCount: number;
    reportCount: number;
    demoResetEnabled: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchHealth() {
      try {
        const res = await fetch("/api/health");
        if (res.ok && active) {
          const data = await res.json();
          setHealthStatus(data);
        }
      } catch {
        if (active) {
          setHealthStatus({ reachable: false, wardCount: 0, reportCount: 0, demoResetEnabled: false });
        }
      }
    }
    fetchHealth();
    return () => {
      active = false;
    };
  }, []);

  const handleSelectWard = (ward: string) => {
    setSelectedWardName(ward);
    setActiveTab("map");
  };

  const runAudit = async () => {
    setIsAuditing(true);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setAuditResult(data);
    } catch {
      setAuditResult({ error: "Failed to run audit" });
    }
    setIsAuditing(false);
  };

  return (
    <div className="flex flex-col h-screen w-full max-w-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Primary Command Centre Header */}
      <header className="px-4 py-2.5 bg-slate-950 border-b border-slate-800/90 flex flex-wrap justify-between items-center gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-500/40 flex items-center justify-center font-black text-red-500 text-sm">
            SK
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-100">SafaiKavach</h1>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-slate-800 border border-slate-700 text-slate-400">
                Command Centre
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Municipal Hazard Intelligence & Fleet Operations</p>
          </div>
        </div>

        {/* Tab Navigation Centered in Top Command Header */}
        <nav aria-label="Dashboard Views" className="bg-slate-900/90 border border-slate-800 rounded-lg p-1 flex gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("map")}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "map"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <span>Live Incident Map</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-950 text-blue-200 border border-blue-800/80 font-mono">
              {Math.min(reports.length, 300)}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("early_warning")}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "early_warning"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <span>Early Warning</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-amber-300 border border-slate-700 font-mono">
              4W
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("mitigation")}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "mitigation"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <span>Mitigation Strategy</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-950 text-emerald-200 border border-emerald-800/80 font-mono">
              7D
            </span>
          </button>
        </nav>

        {/* Global Controls & System Health */}
        <div className="flex items-center gap-2 flex-wrap">
          {healthStatus && (
            <div
              className={`text-[11px] px-2.5 py-1 rounded-md border font-mono flex items-center gap-1.5 ${
                healthStatus.reachable
                  ? "bg-emerald-950/40 border-emerald-800/70 text-emerald-300"
                  : "bg-red-950/60 border-red-800 text-red-300"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  healthStatus.reachable ? "bg-emerald-400" : "bg-red-500 animate-pulse"
                }`}
              />
              {healthStatus.reachable
                ? `DB: ${healthStatus.wardCount} wards (${healthStatus.reportCount} reports)`
                : "Database offline"}
            </div>
          )}

          {healthStatus?.demoResetEnabled && (
            <button
              type="button"
              onClick={loadDemoData}
              disabled={isResetting}
              className="px-2.5 py-1 bg-blue-600/80 hover:bg-blue-600 border border-blue-500/50 disabled:opacity-50 rounded text-xs font-medium transition-colors text-white cursor-pointer"
            >
              {isResetting ? "Resetting..." : "Reset Demo Data"}
            </button>
          )}

          <button
            type="button"
            onClick={resetView}
            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 rounded text-xs font-medium transition-colors text-slate-300 border border-slate-800 cursor-pointer"
            title="Reset active map filters"
          >
            Reset Filters
          </button>

          <button
            type="button"
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 rounded text-xs font-medium transition-colors text-slate-200 border border-slate-700 flex items-center gap-1.5 cursor-pointer"
            title={isSidebarOpen ? "Collapse reporting sidebar" : "Expand reporting sidebar"}
          >
            <span className="font-mono text-slate-400">{isSidebarOpen ? "<<" : ">>"}</span>
            <span>{isSidebarOpen ? "Hide Reporter" : "Show Reporter"}</span>
          </button>
        </div>
      </header>

      {/* Main Command Workspace */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0 md:h-full h-auto overflow-y-auto md:overflow-hidden relative">
        {/* Collapsible Left Incident Reporter & Recent Stream */}
        {isSidebarOpen && (
          <aside aria-label="Incident Reporter" className="w-full md:w-[380px] max-w-full flex flex-col border-r border-slate-800/80 bg-slate-900/95 md:overflow-y-auto p-3.5 gap-4 shrink-0 overflow-x-hidden">
            <div className="border-b border-slate-800/80 shrink-0 pb-3">
              <VoiceReporter />
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">Recent Incident Stream</h3>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  {reports.length} loaded
                </span>
              </div>

              <div className="space-y-2.5 overflow-y-auto pr-1">
                {reports.map((r) => {
                  const isSelected = selectedReportId === r.report_id;
                  const badge = getDispatchBadge(r.action_required);
                  const toneClasses =
                    badge.tone === "danger"
                      ? "bg-red-950/80 border border-red-800 text-red-300"
                      : badge.tone === "warning"
                      ? "bg-amber-950/80 border border-amber-800 text-amber-300"
                      : "bg-slate-800 border border-slate-700 text-slate-300";

                  return (
                    <div
                      key={r.report_id}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? "bg-slate-800/90 border-blue-500 shadow-md shadow-blue-950/30"
                          : "bg-slate-950/70 border-slate-800/80 hover:border-slate-700 hover:bg-slate-950"
                      }`}
                      onClick={() => setSelectedReportId(r.report_id)}
                    >
                      <div className="flex justify-between items-start gap-1">
                        <span className="font-mono text-[11px] font-semibold text-slate-400">{r.report_id}</span>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold tracking-wide ${toneClasses}`}>
                            {badge.label}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                              r.severity_level >= 7
                                ? "bg-red-500/20 text-red-400 border-red-500/30"
                                : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                            }`}
                          >
                            Sev {r.severity_level}
                          </span>
                        </div>
                      </div>

                      <h4 className="font-semibold text-xs mt-1.5 text-slate-100 truncate">
                        {humanizeCategory(r.hazard_category)}
                      </h4>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">{r.raw_location}</p>

                      {!r.coordinates && (
                        <span className="text-[9px] bg-red-950/70 text-red-400 border border-red-900/60 px-1.5 py-0.2 rounded mt-1.5 inline-block">
                          Location unmapped
                        </span>
                      )}
                    </div>
                  );
                })}

                {reports.length === 0 && (
                  <div className="text-center text-slate-500 text-xs py-8">No incident reports recorded yet</div>
                )}

                {hasMore && reports.length > 0 && (
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    className="w-full mt-2 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-slate-300 rounded-lg text-xs font-medium border border-slate-800 transition-colors cursor-pointer"
                  >
                    {isLoadingMore ? "Loading more incidents..." : "Load next 50 incidents"}
                  </button>
                )}
              </div>
            </div>
          </aside>
        )}

        {/* Primary View Pane (Live Map / Early Warning / Mitigation) */}
        <main aria-label="Main Command Center View" className="flex-1 flex flex-col bg-slate-900 min-h-[500px] md:min-h-0 relative overflow-hidden">
          {/* TAB 1: LIVE MAP */}
          <div className={`flex flex-col h-full ${activeTab === "map" ? "flex" : "hidden"}`}>
            {/* Command Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-2.5 bg-slate-950 border-b border-slate-800/80 shrink-0 text-xs text-slate-400">
              <div className="bg-slate-900/80 border border-slate-800/80 p-2 rounded-lg">
                <span className="text-[10px] text-slate-500 block uppercase font-mono">Total Reports</span>
                <span className="text-base font-bold text-slate-100">{total}</span>
              </div>
              <div className="bg-slate-900/80 border border-red-950/70 p-2 rounded-lg">
                <span className="text-[10px] text-red-400 block uppercase font-mono">High Severity</span>
                <span className="text-base font-bold text-red-400">{highSev}</span>
              </div>
              <div className="bg-slate-900/80 border border-slate-800/80 p-2 rounded-lg">
                <span className="text-[10px] text-slate-500 block uppercase font-mono">Avg Severity</span>
                <span className="text-base font-bold text-slate-200">{avgSev} / 10</span>
              </div>
              <div className="bg-slate-900/80 border border-slate-800/80 p-2 rounded-lg">
                <span className="text-[10px] text-slate-500 block uppercase font-mono">Hazmat Actions</span>
                <span className="text-base font-bold text-slate-200">{hazmat}</span>
              </div>
              <div
                title="Illustrative estimate. Scaled by severity/10. Not measured savings. Based on synthetic data."
                className="bg-slate-900/80 border border-slate-800/80 p-2 rounded-lg cursor-help col-span-2 sm:col-span-1 lg:col-span-1"
              >
                <span className="text-[10px] text-slate-500 block uppercase font-mono truncate">Est. Prevented</span>
                <span className="text-sm font-bold text-emerald-400 truncate block">₹{totalNetInr.toLocaleString()}</span>
              </div>
              <div className="col-span-2 sm:col-span-1 lg:col-span-1 flex items-center justify-end">
                <button
                  type="button"
                  onClick={runAudit}
                  disabled={isAuditing}
                  className="w-full h-full py-2 bg-purple-900/40 hover:bg-purple-900/70 text-purple-200 border border-purple-700/60 rounded-lg text-xs font-semibold shadow transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                  <span>{isAuditing ? "Auditing..." : "Run Weekly Audit"}</span>
                </button>
              </div>
            </div>

            {/* In-Memory Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-950/90 border-b border-slate-800/80 text-xs shrink-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="map-filter-cat" className="text-slate-400 text-[11px] font-medium">Category:</label>
                  <select
                    id="map-filter-cat"
                    value={mapFilterCategory}
                    onChange={(e) => setMapFilterCategory(e.target.value)}
                    className="bg-slate-900 border border-slate-700/80 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-blue-500"
                  >
                    <option value="all">All Categories</option>
                    {ALL_HAZARD_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {getCategoryLabel(cat)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <label htmlFor="map-filter-sev" className="text-slate-400 text-[11px] font-medium">Min Severity:</label>
                  <select
                    id="map-filter-sev"
                    value={mapFilterMinSeverity}
                    onChange={(e) => setMapFilterMinSeverity(Number(e.target.value))}
                    className="bg-slate-900 border border-slate-700/80 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-blue-500"
                  >
                    <option value={0}>All (0+)</option>
                    <option value={3}>Low+ (3+)</option>
                    <option value={5}>Moderate+ (5+)</option>
                    <option value={7}>High+ (7+)</option>
                    <option value={9}>Critical (9+)</option>
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <label htmlFor="map-filter-act" className="text-slate-400 text-[11px] font-medium">Action:</label>
                  <select
                    id="map-filter-act"
                    value={mapFilterAction}
                    onChange={(e) => setMapFilterAction(e.target.value)}
                    className="bg-slate-900 border border-slate-700/80 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-blue-500"
                  >
                    <option value="all">All Actions</option>
                    <option value="hazmat">Hazmat Bypass</option>
                    <option value="bypass">Standard Bypass</option>
                    <option value="routine">Routine Collection</option>
                  </select>
                </div>

                {(mapFilterCategory !== "all" || mapFilterMinSeverity > 0 || mapFilterAction !== "all") && (
                  <button
                    type="button"
                    onClick={() => {
                      setMapFilterCategory("all");
                      setMapFilterMinSeverity(0);
                      setMapFilterAction("all");
                    }}
                    className="text-slate-400 hover:text-slate-200 underline text-[11px] cursor-pointer"
                  >
                    Clear filters
                  </button>
                )}
              </div>

              <div className="text-[10px] text-amber-300/80 bg-slate-900/90 px-2 py-0.5 rounded border border-slate-800">
                Filters apply only to loaded markers
              </div>
            </div>

            {/* Map Container */}
            <div className="flex-1 relative z-0">
              {!isSidebarOpen && (
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(true)}
                  className="absolute top-16 left-3 z-[450] bg-slate-950/90 hover:bg-slate-900 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 shadow-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Open reporting panel"
                >
                  <span className="font-mono text-slate-400">&gt;&gt;</span>
                  <span>Show Reporter</span>
                </button>
              )}

              <HazardMap
                selectedReportId={selectedReportId}
                onSelectReport={setSelectedReportId}
                auditResult={auditResult}
                selectedWardName={selectedWardName}
                isActive={activeTab === "map"}
                totalReportCount={total}
                filterCategory={mapFilterCategory}
                filterMinSeverity={mapFilterMinSeverity}
                filterAction={mapFilterAction}
              />

              {/* Weekly Audit Modal Overlay */}
              {auditResult && auditResult.status === "success" && (
                <div className="absolute top-3 left-3 z-[500] bg-slate-950/95 backdrop-blur p-4 rounded-xl shadow-2xl border border-purple-500/80 max-w-sm text-xs space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h4 className="font-bold text-purple-400 flex items-center gap-1.5 text-xs">
                      <span>Weekly Root-Cause Audit</span>
                    </h4>
                    {auditResult.source === "template_fallback" ? (
                      <span className="text-[9px] bg-slate-800 text-slate-400 border border-slate-700 px-1.5 py-0.2 rounded font-mono">
                        Template Fallback
                      </span>
                    ) : (
                      <span className="text-[9px] bg-purple-950 text-purple-200 border border-purple-800 px-1.5 py-0.2 rounded font-mono">
                        AI Hypothesis
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5 text-slate-300 text-[11px]">
                    <p>
                      <strong className="text-slate-100">Ward:</strong> {auditResult.ward as string}{" "}
                      <span className="text-red-400">(+{auditResult.pct_increase as number}% anomaly)</span>
                    </p>
                    <p>
                      <strong className="text-slate-100">Dominant Category:</strong>{" "}
                      {humanizeCategory(auditResult.dominant_anomaly as string)}
                    </p>
                    <p>
                      <strong className="text-slate-100">Possible Cause:</strong> {auditResult.root_cause as string}
                    </p>
                    <p>
                      <strong className="text-slate-100">Recommended Action:</strong>{" "}
                      {auditResult.recommendation as string}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAuditResult(null)}
                    className="w-full bg-slate-900 hover:bg-slate-800 py-1.5 rounded text-[11px] text-slate-300 font-medium border border-slate-700 transition-colors cursor-pointer"
                  >
                    Dismiss Audit Summary
                  </button>
                </div>
              )}

              {auditResult && auditResult.status === "insufficient_data" && (
                <div className="absolute top-3 left-3 z-[500] bg-slate-950/95 p-3 rounded-lg shadow-xl border border-slate-700 text-xs max-w-xs space-y-2">
                  <p className="text-slate-300 text-[11px]">
                    Insufficient incident volume for weekly audit. Requires at least 3 reports of the same category in a ward this week.
                  </p>
                  <button
                    type="button"
                    onClick={() => setAuditResult(null)}
                    className="w-full bg-slate-900 hover:bg-slate-800 py-1 rounded text-xs text-slate-300 border border-slate-700 cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* TAB 2: EARLY WARNING */}
          {activeTab === "early_warning" && (
            <EarlyWarningPanel reports={reports} onSelectWard={handleSelectWard} />
          )}

          {/* TAB 3: MITIGATION STRATEGY */}
          {activeTab === "mitigation" && <MitigationPlanPanel />}
        </main>
      </div>

      {/* Synthetic Data Disclaimer Footer: Relocated cleanly to the bottom of the first screen */}
      <footer className="px-4 py-2 bg-slate-950 border-t border-slate-900 text-[11px] text-amber-300/90 text-center shrink-0 tracking-wide">
        {DATA_DISCLOSURE_TEXT}
      </footer>
    </div>
  );
}
