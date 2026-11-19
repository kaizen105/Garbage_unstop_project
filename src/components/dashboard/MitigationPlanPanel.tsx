"use client";

import { useState, useEffect } from "react";
import { GeneratePlanResult } from "@/lib/mitigation/service";
import { humanizeCategory } from "@/lib/utils/format";

export function MitigationPlanPanel() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GeneratePlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 space-y-6 bg-slate-900 text-slate-100">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-emerald-400">7-Day Municipal Mitigation Strategy</h2>
          <p className="text-sm text-slate-400">
            Automated intelligence and grounded dispatch strategy across 290 Delhi MCD ward boundaries (synthetic incident data).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fetchPlan(false)}
            disabled={loading}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded font-medium text-sm transition-colors"
          >
            {loading ? "Generating Strategy..." : "Load / Refresh Plan"}
          </button>
          <button
            onClick={() => fetchPlan(true)}
            disabled={loading}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded font-medium text-xs transition-colors"
            title="Force bypass cache and regenerate using LLM"
          >
            Force Run LLM
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-950/60 border border-red-800 rounded-lg text-red-300 text-sm">
          <strong>Error:</strong> {error}
        </div>
      )}

      {!data && !loading && !error && (
        <div className="flex flex-col items-center justify-center p-12 text-slate-400 border border-dashed border-slate-800 rounded-xl space-y-3">
          <svg className="w-12 h-12 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm">Click &quot;Load / Refresh Plan&quot; to synthesize weekly incident aggregates.</p>
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Metadata badges */}
          <div className="flex flex-wrap gap-2 text-xs items-center bg-slate-950/80 p-3 rounded-lg border border-slate-800">
            <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">
              Generated: {new Date(data.generatedAt).toLocaleString()}
            </span>
            <span className={`px-2.5 py-1 rounded ${data.cached ? "bg-amber-950/80 text-amber-300" : "bg-emerald-950/80 text-emerald-300"}`}>
              {data.cached ? "Cached (< 60m)" : "Fresh Synthesis"}
            </span>
            <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300">
              Model: {data.model === "openrouter/free" && data.servedModel && !data.model.includes("served by")
                ? `${data.model} (served by ${data.servedModel})`
                : data.model}
            </span>
            {data.includesSynthetic && (
              <span className="px-2.5 py-1 rounded bg-purple-950/80 text-purple-300">
                Includes Synthetic Seed Data
              </span>
            )}
            {data.aggregates && (
              <span className="px-2.5 py-1 rounded bg-blue-950/80 text-blue-300 ml-auto font-mono">
                7d Active Incidents: {data.aggregates.totals.current7} (Prev: {data.aggregates.totals.previous7})
              </span>
            )}
          </div>

          {data.asOf && (
            <div className="text-xs text-slate-500 -mt-2">
              Data as of {new Date(data.asOf).toLocaleString()}
            </div>
          )}

          {typeof data.unresolvedCount === "number" && (
            <div className="text-xs text-slate-400 -mt-2">
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
              {/* Executive Headline */}
              <div className="p-4 bg-emerald-950/30 border border-emerald-800/80 rounded-xl">
                <span className="text-xs uppercase tracking-wider text-emerald-400 font-semibold block mb-1">
                  Executive Operational Directive
                </span>
                <p className="text-lg font-medium text-emerald-100">{data.plan.headline}</p>
              </div>

              {/* Priority Cards */}
              <div className="space-y-4">
                <h3 className="text-md font-semibold text-slate-300">Targeted Priority Interventions</h3>
                <div className="grid grid-cols-1 gap-4">
                  {data.plan.priorities.map((p, idx) => (
                    <div key={`${p.wardKey}-${p.category}-${idx}`} className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-3 border-b border-slate-800">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-base font-bold text-white">{p.wardName}</span>
                            <span className="text-xs font-mono text-slate-500">({p.wardKey})</span>
                          </div>
                          <span className="text-sm text-slate-400">{humanizeCategory(p.category)}</span>
                        </div>
                        <div className="flex gap-2">
                          <span className={`text-xs px-2.5 py-1 rounded-full uppercase font-bold tracking-wide ${
                            p.urgency === "immediate"
                              ? "bg-red-500/20 text-red-400 border border-red-500/40"
                              : p.urgency === "this_week"
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                              : "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                          }`}>
                            {p.urgency}
                          </span>
                        </div>
                      </div>

                      {/* Grounded incident metrics */}
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-3 bg-slate-900 rounded-lg text-xs">
                        <div>
                          <div className="text-slate-500">7-Day Count</div>
                          <div className="font-bold text-slate-200 text-sm">{p.current7}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Prior 7-Day</div>
                          <div className="font-bold text-slate-400 text-sm">{p.previous7}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Net Delta</div>
                          <div className={`font-bold text-sm ${p.delta > 0 ? "text-red-400" : "text-emerald-400"}`}>
                            {p.delta > 0 ? `+${p.delta}` : p.delta}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Avg Severity</div>
                          <div className="font-bold text-yellow-400 text-sm">{p.avgSeverity} / 10</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Max Severity</div>
                          <div className="font-bold text-red-400 text-sm">{p.maxSeverity} / 10</div>
                        </div>
                      </div>

                      {/* Likely Causes */}
                      <div>
                        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
                          Diagnostic Hypotheses & Root Causes
                        </div>
                        <ul className="list-disc list-inside space-y-1 text-sm text-slate-300">
                          {p.likelyCauses.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </div>

                      {/* Actions */}
                      <div>
                        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                          Operational Actions & Task Force Assignment
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {p.actions.map((act, i) => (
                            <div key={i} className="p-3 bg-slate-900/80 rounded border border-slate-800 flex flex-col justify-between">
                              <span className="text-xs font-bold text-blue-400 mb-1">{act.owner}</span>
                              <span className="text-xs text-slate-200 leading-relaxed">{act.action}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cross-Cutting Actions */}
              {data.plan.crossCuttingActions.length > 0 && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3">
                  <h3 className="text-md font-semibold text-slate-300">Cross-Cutting Citywide Mandates</h3>
                  <div className="space-y-2">
                    {data.plan.crossCuttingActions.map((action, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-slate-900 rounded-lg text-sm text-slate-200">
                        <span className="text-emerald-400 font-bold">#{i + 1}</span>
                        <span>{action}</span>
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
