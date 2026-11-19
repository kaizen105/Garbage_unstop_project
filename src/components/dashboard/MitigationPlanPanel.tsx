"use client";

import { useState, useEffect, useMemo } from "react";
import { GeneratePlanResult } from "@/lib/mitigation/service";
import { humanizeCategory } from "@/lib/utils/format";

export function MitigationPlanPanel() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GeneratePlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedUrgency, setSelectedUrgency] = useState<"all" | "immediate" | "this_week" | "monitor">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch cached plan on mount via GET (does not trigger LLM generation)
  useEffect(() => {
    let active = true;
    async function loadInitialPlan() {
      try {
        const res = await fetch("/api/mitigation-plan", { method: "GET" });
        if (res.ok && active) {
          const json: GeneratePlanResult = await res.json();
          if (json.plan) {
            setData(json);
          }
        }
      } catch (err: unknown) {
        console.warn("Failed to load initial cached mitigation plan:", err);
      }
    }
    loadInitialPlan();
    return () => {
      active = false;
    };
  }, []);

  const fetchPlan = async (force: boolean = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mitigation-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP error ${res.status}`);
      }

      const json: GeneratePlanResult = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load mitigation plan");
    } finally {
      setLoading(false);
    }
  };

  // Department / Owner count breakdown
  const departmentBreakdown = useMemo(() => {
    if (!data?.plan?.priorities) return [];
    const counts: Record<string, number> = {};
    for (const p of data.plan.priorities) {
      for (const act of p.actions) {
        const owner = act.owner.trim() || "Unassigned";
        counts[owner] = (counts[owner] || 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [data]);

  // Filtered priorities
  const filteredPriorities = useMemo(() => {
    if (!data?.plan?.priorities) return [];
    return data.plan.priorities.filter((p) => {
      if (selectedUrgency !== "all" && p.urgency !== selectedUrgency) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const wardMatch = p.wardName.toLowerCase().includes(q) || p.wardKey.toLowerCase().includes(q);
        const catMatch = p.category.toLowerCase().includes(q);
        const actionMatch = p.actions.some(a => a.action.toLowerCase().includes(q) || a.owner.toLowerCase().includes(q));
        if (!wardMatch && !catMatch && !actionMatch) return false;
      }
      return true;
    });
  }, [data, selectedUrgency, searchQuery]);

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 sm:p-6 space-y-6 bg-slate-900 text-slate-100">
      {/* Top Banner / Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 shadow-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-xl font-bold tracking-tight text-white">7-Day Municipal Mitigation Strategy</h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Grounded dispatch strategy and department assignments across 290 legacy pre-2022 Delhi MCD ward polygons (synthetic incident data).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchPlan(false)}
            disabled={loading}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-medium text-xs sm:text-sm transition-all shadow-sm"
          >
            {loading ? "Synthesizing Plan..." : "Load / Refresh Plan"}
          </button>
          <button
            onClick={() => fetchPlan(true)}
            disabled={loading}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg font-medium text-xs transition-colors border border-slate-700"
            title="Force bypass cache and regenerate using LLM"
          >
            Force Run LLM
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-950/60 border border-red-800 rounded-lg text-red-300 text-sm">
          <strong className="font-semibold">Error:</strong> {error}
        </div>
      )}

      {!data && !loading && !error && (
        <div className="flex flex-col items-center justify-center p-12 text-slate-400 border border-dashed border-slate-800 rounded-xl space-y-3 bg-slate-950/40">
          <svg className="w-12 h-12 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm font-medium">Click &quot;Load / Refresh Plan&quot; to synthesize weekly incident aggregates.</p>
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Metadata Bar */}
          <div className="flex flex-wrap items-center gap-2 text-xs bg-slate-950 p-3 rounded-lg border border-slate-800">
            <span className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 font-mono">
              Generated: {new Date(data.generatedAt).toLocaleString()}
            </span>
            <span className={`px-2.5 py-1 rounded font-medium border ${
              data.cached 
                ? "bg-amber-950/40 border-amber-800/60 text-amber-300" 
                : "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
            }`}>
              {data.cached ? "Cached (< 60m)" : "Fresh Synthesis"}
            </span>
            <span className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 font-mono">
              Model: {data.model === "openrouter/free" && data.servedModel && !data.model.includes("served by")
                ? `${data.model} (served by ${data.servedModel})`
                : data.model}
            </span>
            {data.includesSynthetic && (
              <span className="px-2.5 py-1 rounded bg-purple-950/50 border border-purple-800/60 text-purple-300">
                Synthetic Baseline
              </span>
            )}
            {data.aggregates && (
              <span className="px-2.5 py-1 rounded bg-blue-950/50 border border-blue-800/60 text-blue-300 sm:ml-auto font-mono">
                7d Active Incidents: {data.aggregates.totals.current7} (Prev: {data.aggregates.totals.previous7})
              </span>
            )}
          </div>

          {data.asOf && (
            <div className="text-xs text-slate-400 font-mono">
              Data as of {new Date(data.asOf).toLocaleString()}
            </div>
          )}

          {typeof data.unresolvedCount === "number" && (
            <div className="text-xs text-slate-400">
              {data.unresolvedCount} reports in the last 7 days could not be matched to a ward
            </div>
          )}

          {data.status === "no_data" && (
            <div className="p-8 text-center bg-slate-950 rounded-xl border border-slate-800 text-slate-400">
              No reports recorded in the last 7 days.
            </div>
          )}

          {data.status === "degraded" && (
            <div className="p-4 bg-yellow-950/50 border border-yellow-800 text-yellow-300 rounded-lg text-sm">
              Plan generation degraded: {data.error || "LLM synthesis unavailable. Displaying raw data without synthesized plan."}
            </div>
          )}

          {data.plan && (
            <div className="space-y-6">
              {/* Executive Operational Directive */}
              <div className="p-5 bg-gradient-to-r from-emerald-950/40 to-slate-950 border border-emerald-800/60 rounded-xl shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    Executive Operational Directive
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Mandatory Municipal Response
                  </span>
                </div>
                <p className="text-base sm:text-lg font-medium text-emerald-100 leading-snug">
                  &ldquo;{data.plan.headline}&rdquo;
                </p>
              </div>

              {/* Department Allocation Summary */}
              {departmentBreakdown.length > 0 && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                      Department Allocation Overview
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      {departmentBreakdown.reduce((sum, d) => sum + d[1], 0)} Total Action Items
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {departmentBreakdown.map(([owner, count]) => (
                      <div key={owner} className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-2.5 flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-300 truncate pr-2" title={owner}>
                          {owner}
                        </span>
                        <span className="text-xs font-mono font-bold text-blue-400 bg-blue-950/60 border border-blue-800/50 px-2 py-0.5 rounded">
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Priority Interventions Filter Bar */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-white">Targeted Priority Interventions</h3>
                    <span className="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
                      {filteredPriorities.length} of {data.plan.priorities.length}
                    </span>
                  </div>

                  {/* Urgency and Search Filters */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                      {(["all", "immediate", "this_week", "monitor"] as const).map((tier) => (
                        <button
                          key={tier}
                          onClick={() => setSelectedUrgency(tier)}
                          className={`px-2.5 py-1 rounded font-medium transition-colors ${
                            selectedUrgency === tier
                              ? "bg-slate-800 text-white shadow-sm"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          {tier === "all" ? "All" : tier === "immediate" ? "Immediate" : tier === "this_week" ? "This Week" : "Monitor"}
                        </button>
                      ))}
                    </div>

                    <input
                      type="text"
                      placeholder="Search ward or action..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-600"
                    />
                  </div>
                </div>

                {/* Priority Cards List */}
                <div className="grid grid-cols-1 gap-4">
                  {filteredPriorities.map((p, idx) => (
                    <div key={`${p.wardKey}-${p.category}-${idx}`} className="bg-slate-950 border border-slate-800/90 rounded-xl p-5 space-y-4 shadow-sm hover:border-slate-700/80 transition-colors">
                      {/* Card Header */}
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-3 border-b border-slate-800/80">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-base font-bold text-white">{p.wardName}</span>
                            <span className="text-xs font-mono text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                              {p.wardKey}
                            </span>
                          </div>
                          <span className="text-xs text-slate-400 font-medium">{humanizeCategory(p.category)}</span>
                        </div>
                        <div>
                          <span className={`text-xs px-2.5 py-1 rounded-full font-mono uppercase font-bold tracking-wide border ${
                            p.urgency === "immediate"
                              ? "bg-red-500/10 text-red-400 border-red-500/30"
                              : p.urgency === "this_week"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                              : "bg-blue-500/10 text-blue-400 border-blue-500/30"
                          }`}>
                            {p.urgency}
                          </span>
                        </div>
                      </div>

                      {/* Block 1: Evidence */}
                      <div className="border border-slate-800/80 bg-slate-900/60 rounded-lg p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                            Block 1: Quantitative Evidence
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            Aggregated from SQL records
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs pt-1">
                          <div className="bg-slate-950/60 p-2 rounded border border-slate-800/50">
                            <div className="text-slate-400 text-[10px] uppercase font-mono">7-Day Count</div>
                            <div className="font-bold text-slate-100 text-sm mt-0.5">{p.current7}</div>
                          </div>
                          <div className="bg-slate-950/60 p-2 rounded border border-slate-800/50">
                            <div className="text-slate-400 text-[10px] uppercase font-mono">Prior 7-Day</div>
                            <div className="font-bold text-slate-300 text-sm mt-0.5">{p.previous7}</div>
                          </div>
                          <div className="bg-slate-950/60 p-2 rounded border border-slate-800/50">
                            <div className="text-slate-400 text-[10px] uppercase font-mono">Net Delta</div>
                            <div className={`font-bold text-sm mt-0.5 ${p.delta > 0 ? "text-red-400" : "text-emerald-400"}`}>
                              {p.delta > 0 ? `+${p.delta}` : p.delta}
                            </div>
                          </div>
                          <div className="bg-slate-950/60 p-2 rounded border border-slate-800/50">
                            <div className="text-slate-400 text-[10px] uppercase font-mono">Avg Severity</div>
                            <div className="font-bold text-amber-300 text-sm mt-0.5">{p.avgSeverity} / 10</div>
                          </div>
                          <div className="bg-slate-950/60 p-2 rounded border border-slate-800/50">
                            <div className="text-slate-400 text-[10px] uppercase font-mono">Max Severity</div>
                            <div className="font-bold text-red-400 text-sm mt-0.5">{p.maxSeverity} / 10</div>
                          </div>
                        </div>
                      </div>

                      {/* Block 2: Hypotheses */}
                      <div className="border border-slate-800/80 bg-slate-900/60 rounded-lg p-3.5 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                            Block 2: Diagnostic Hypotheses
                          </span>
                          <span className="text-[10px] text-amber-400 bg-amber-950/40 border border-amber-800/50 px-2 py-0.5 rounded font-mono font-medium">
                            Model hypothesis, not confirmed
                          </span>
                        </div>
                        <ul className="space-y-1.5 text-xs text-slate-300 pt-1">
                          {p.likelyCauses.map((c, i) => (
                            <li key={i} className="flex items-start gap-2 bg-slate-950/40 p-2 rounded border border-slate-800/40">
                              <span className="text-amber-400 font-mono text-[11px] mt-0.5">({i + 1})</span>
                              <span className="leading-relaxed">{c}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Block 3: Actions */}
                      <div className="border border-slate-800/80 bg-slate-900/60 rounded-lg p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                            Block 3: Prescribed Operational Actions
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {p.actions.length} Task Assignments
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                          {p.actions.map((act, i) => (
                            <div key={i} className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 flex flex-col justify-between space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-mono font-semibold text-blue-400 bg-blue-950/50 border border-blue-900/60 px-2 py-0.5 rounded">
                                  {act.owner}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">Step #{i + 1}</span>
                              </div>
                              <span className="text-xs text-slate-200 leading-relaxed">{act.action}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  {filteredPriorities.length === 0 && (
                    <div className="p-6 text-center bg-slate-950 rounded-xl border border-slate-800 text-slate-400 text-sm">
                      No interventions match the selected urgency or search criteria.
                    </div>
                  )}
                </div>
              </div>

              {/* Cross-Cutting Actions */}
              {data.plan.crossCuttingActions.length > 0 && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400" />
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
                      Cross-Cutting Citywide Mandates
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {data.plan.crossCuttingActions.map((action, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-slate-900/80 border border-slate-800 rounded-lg text-xs text-slate-200">
                        <span className="text-emerald-400 font-mono font-bold text-sm">#{i + 1}</span>
                        <span className="leading-relaxed">{action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
