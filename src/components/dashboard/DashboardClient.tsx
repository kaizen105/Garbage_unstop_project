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
  const [activeTab, setActiveTab] = useState<"map" | "early_warning" | "mitigation">("map");
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
      // Server runs bounded SQL query when reports array is omitted
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
    <div className="flex flex-col h-screen w-full max-w-full bg-slate-900 text-slate-100 overflow-x-hidden overflow-y-hidden">
      <header className="px-4 sm:px-6 py-3 sm:py-4 bg-slate-950 border-b border-slate-800 flex flex-wrap justify-between items-center gap-2 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-red-500">SafaiKavach</h1>
          <p className="text-xs sm:text-sm text-slate-400">Hear the hazard before it hurts.</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {healthStatus && (
            <div className={`text-xs px-3 py-1.5 rounded-full border font-mono flex items-center gap-2 ${
              healthStatus.reachable
                ? "bg-emerald-950/60 border-emerald-800 text-emerald-300"
                : "bg-red-950/60 border-red-800 text-red-300"
            }`}>
              <span className={`w-2 h-2 rounded-full ${healthStatus.reachable ? "bg-emerald-400" : "bg-red-500 animate-pulse"}`} />
              {healthStatus.reachable
                ? `Database connected, ${healthStatus.wardCount} wards, ${healthStatus.reportCount} reports (synthetic)`
                : "Database unreachable"}
            </div>
          )}

          {healthStatus?.demoResetEnabled && (
            <button
              onClick={loadDemoData}
              disabled={isResetting}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-xs font-medium transition-colors"
            >
              {isResetting ? "Resetting Demo..." : "Reset demo data"}
            </button>
          )}

          <button
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs font-medium transition-colors text-slate-200 border border-slate-700 flex items-center gap-1.5"
            title={isSidebarOpen ? "Collapse reporting panel" : "Expand reporting panel"}
          >
            <span className="font-mono text-slate-400">{isSidebarOpen ? "<<" : ">>"}</span>
            <span>{isSidebarOpen ? "Hide Reporter" : "Show Reporter"}</span>
          </button>

          <button
            onClick={resetView}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs font-medium transition-colors text-slate-300 border border-slate-700"
            title="Reset local filter view"
          >
            Reset View
          </button>
        </div>
      </header>

      <div className="flex flex-col md:flex-row flex-1 min-h-0 md:h-full h-auto overflow-y-auto md:overflow-hidden">
        {isSidebarOpen && (
          <div className="w-full md:w-[380px] max-w-full flex flex-col border-r border-slate-800 bg-slate-900 md:overflow-y-auto p-4 gap-4 shrink-0 overflow-x-hidden">
            <div className="border-b border-slate-800 shrink-0 pb-4">
              <VoiceReporter />
            </div>

            <div className="flex-1">
              <h2 className="text-lg font-semibold mb-4 text-slate-200">Recent Reports</h2>
              <div className="space-y-3">
              {reports.map((r) => (
                <div
                  key={r.report_id}
                  className={`p-3 rounded border cursor-pointer transition-colors ${
                    selectedReportId === r.report_id
                      ? "bg-slate-800 border-red-500"
                      : "bg-slate-950 border-slate-800 hover:border-slate-600"
                  }`}
                  onClick={() => setSelectedReportId(r.report_id)}
                >
                  <div className="flex justify-between items-start gap-1">
                    <span className="font-mono text-xs text-slate-400">{r.report_id}</span>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {(() => {
                        const badge = getDispatchBadge(r.action_required);
                        const toneClasses =
                          badge.tone === "danger"
                            ? "bg-red-950/80 border border-red-800 text-red-300"
                            : badge.tone === "warning"
                            ? "bg-amber-950/80 border border-amber-800 text-amber-300"
                            : "bg-slate-800 border border-slate-700 text-slate-300";
                        return (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold tracking-wide ${toneClasses}`}>
                            {badge.label}
                          </span>
                        );
                      })()}
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          r.severity_level >= 7 ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                        }`}
                      >
                        Sev {r.severity_level}
                      </span>
                    </div>
                  </div>
                  <h3 className="font-medium mt-1 truncate">{humanizeCategory(r.hazard_category)}</h3>
                  <p className="text-sm text-slate-500 truncate">{r.raw_location}</p>
                  {!r.coordinates && (
                    <span className="text-[10px] bg-red-900/50 text-red-300 px-1.5 py-0.5 rounded mt-1 inline-block">
                      Location not resolved
                    </span>
                  )}
                </div>
              ))}
              {reports.length === 0 && <div className="text-center text-slate-500 text-sm py-8">No reports yet</div>}
              {hasMore && reports.length > 0 && (
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="w-full mt-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded text-xs font-medium border border-slate-700 transition-colors"
                >
                  {isLoadingMore ? "Loading more..." : "Load more"}
                </button>
              )}
            </div>
          </div>
        </div>
        )}

        <div className="flex-1 flex flex-col bg-slate-800 min-h-[500px] md:min-h-0 relative">
          <div className="bg-slate-950 border-b border-amber-900/60 px-4 py-2 text-xs text-amber-200 text-center leading-relaxed shrink-0">
            {DATA_DISCLOSURE_TEXT}
          </div>
          <div className="bg-slate-900 border-b border-slate-700 p-2 flex justify-center shrink-0">
            <div className="bg-slate-950 rounded-full border border-slate-800 p-1 flex gap-1">
              <button
                onClick={() => setActiveTab("map")}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  activeTab === "map" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Live Map
              </button>
              <button
                onClick={() => setActiveTab("early_warning")}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  activeTab === "early_warning" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Early Warning
              </button>
              <button
                onClick={() => setActiveTab("mitigation")}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  activeTab === "mitigation" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Mitigation Strategy
              </button>
            </div>
          </div>

          <div className={`flex flex-col h-full ${activeTab === "map" ? "flex" : "hidden"}`}>
            {/* Header stats: single emphasis color (High Sev), rest neutral slate */}
            <div className="flex p-3 bg-slate-950 gap-4 text-xs sm:text-sm border-b border-slate-800 shrink-0 flex-wrap items-center text-slate-400">
              <div>
                Total: <span className="font-semibold text-slate-200">{total}</span>
              </div>
              <div className="bg-red-950/40 border border-red-900/60 px-2 py-0.5 rounded">
                High Sev: <span className="font-bold text-red-400">{highSev}</span>
              </div>
              <div>
                Avg Sev: <span className="font-semibold text-slate-200">{avgSev}</span>
              </div>
              <div>
                Hazmat: <span className="font-semibold text-slate-200">{hazmat}</span>
              </div>
              <div
                title="Illustrative estimate. Each non-routine report is assumed to avoid one incident of a fixed cost per category, scaled by severity/10. Not measured savings. Based on synthetic data."
                className="cursor-help border-b border-dashed border-slate-600"
              >
                Est. prevented: <span className="font-semibold text-slate-200">₹{totalNetInr.toLocaleString()}</span>
              </div>

              <button
                onClick={runAudit}
                disabled={isAuditing}
                className="ml-auto bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1 rounded text-xs font-semibold shadow transition-colors flex items-center"
              >
                {isAuditing ? "Auditing..." : "Run Weekly Audit"}
              </button>
            </div>

            {/* In-memory filters for loaded markers */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-slate-950/80 border-b border-slate-800 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="map-filter-cat" className="text-slate-400 font-medium">Category:</label>
                  <select
                    id="map-filter-cat"
                    value={mapFilterCategory}
                    onChange={(e) => setMapFilterCategory(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-slate-500"
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
                  <label htmlFor="map-filter-sev" className="text-slate-400 font-medium">Min Severity:</label>
                  <select
                    id="map-filter-sev"
                    value={mapFilterMinSeverity}
                    onChange={(e) => setMapFilterMinSeverity(Number(e.target.value))}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-slate-500"
                  >
                    <option value={0}>All Severities (0+)</option>
                    <option value={3}>Low+ (3+)</option>
                    <option value={5}>Moderate+ (5+)</option>
                    <option value={7}>High+ (7+)</option>
                    <option value={9}>Critical (9+)</option>
                  </select>
                </div>

                {(mapFilterCategory !== "all" || mapFilterMinSeverity > 0) && (
                  <button
                    onClick={() => {
                      setMapFilterCategory("all");
                      setMapFilterMinSeverity(0);
                    }}
                    className="text-slate-400 hover:text-slate-200 underline text-xs ml-1"
                  >
                    Reset filters
                  </button>
                )}
              </div>

              <div className="text-[11px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                Filters apply to loaded markers only
              </div>
            </div>

            <div className="flex-1 relative z-0">
              {!isSidebarOpen && (
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="absolute top-16 left-4 z-[450] bg-slate-900/95 hover:bg-slate-800 text-slate-200 text-xs px-2.5 py-1.5 rounded-md border border-slate-700 shadow-lg flex items-center gap-1.5 transition-colors"
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
              />

              {auditResult && auditResult.status === "success" && (
                <div className="absolute top-4 left-4 z-[500] bg-slate-900/90 p-4 rounded-lg shadow-xl border border-purple-500 max-w-sm">
                  <h3 className="font-bold text-purple-400 mb-2 flex items-center justify-between">
                    Weekly Root-Cause Audit
                    {auditResult.source === "template_fallback" ? (
                      <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded ml-2">
                        Template text, LLM unavailable
                      </span>
                    ) : (
                      <span className="text-[10px] bg-purple-900 text-purple-200 px-2 py-0.5 rounded ml-2">
                        AI-generated; verify on site
                      </span>
                    )}
                  </h3>
                  <div className="space-y-2 text-sm text-slate-300">
                    {auditResult.model && (
                      <p className="text-xs text-slate-400">
                        <strong className="text-slate-300">Model:</strong>{" "}
                        {auditResult.model === "openrouter/free" && auditResult.servedModel && !auditResult.model.includes("served by")
                          ? `${auditResult.model} (served by ${auditResult.servedModel})`
                          : (auditResult.model as string)}
                      </p>
                    )}
                    <p>
                      <strong className="text-slate-100">Ward:</strong> {auditResult.ward as string}{" "}
                      <span className="text-red-400">(+{auditResult.pct_increase as number}% anomaly)</span>
                    </p>
                    <p>
                      <strong className="text-slate-100">Dominant Anomaly:</strong>{" "}
                      {humanizeCategory(auditResult.dominant_anomaly as string)}
                    </p>
                    <p>
                      <strong className="text-slate-100">Possible cause (hypothesis):</strong> {auditResult.root_cause as string}
                    </p>
                    <p>
                      <strong className="text-slate-100">Recommended Action:</strong>{" "}
                      {auditResult.recommendation as string}
                    </p>
                  </div>
                  <button
                    onClick={() => setAuditResult(null)}
                    className="mt-3 w-full bg-slate-700 hover:bg-slate-600 py-1 rounded text-xs"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {auditResult && auditResult.status === "insufficient_data" && (
                <div className="absolute top-4 left-4 z-[500] bg-slate-900/90 p-4 rounded-lg shadow-xl border border-slate-500">
                  <p className="text-sm text-slate-300">
                    Insufficient data for weekly audit (needs &gt;= 3 reports of same category in a ward this week).
                  </p>
                  <button
                    onClick={() => setAuditResult(null)}
                    className="mt-3 w-full bg-slate-700 hover:bg-slate-600 py-1 rounded text-xs"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          </div>

          {activeTab === "early_warning" && <EarlyWarningPanel reports={reports} onSelectWard={handleSelectWard} />}
          {activeTab === "mitigation" && <MitigationPlanPanel />}
        </div>
      </div>
    </div>
  );
}
