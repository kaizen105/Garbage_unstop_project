"use client";

import { Report } from "@/lib/store/reports";
import { rankHotspots, projectNextWeek } from "@/lib/early-warning/trends";
import { useMemo, useState, useEffect } from "react";
import { humanizeCategory } from "@/lib/utils/format";
import { CATEGORY_COLORS, ALL_HAZARD_CATEGORIES, getCategoryLabel } from "@/lib/categories";
import { HazardCategory } from "@prisma/client";
import type { EarlyWarningResponse } from "@/lib/early-warning/sqlBuckets";
import { getRuleThresholdText } from "@/lib/early-warning/thresholdInfo";

interface EarlyWarningPanelProps {
  reports?: Report[];
  onSelectWard: (wardName: string) => void;
  initialData?: EarlyWarningResponse | null;
}

const catColors = CATEGORY_COLORS;

export function EarlyWarningPanel({ reports = [], onSelectWard, initialData }: EarlyWarningPanelProps) {
  const [serverData, setServerData] = useState<EarlyWarningResponse | null>(initialData ?? null);
  const [isLoading, setIsLoading] = useState(!initialData);

  useEffect(() => {
    let active = true;
    async function loadEarlyWarning() {
      try {
        const res = await fetch("/api/early-warning");
        if (res.ok && active) {
          const json: EarlyWarningResponse = await res.json();
          setServerData(json);
        }
      } catch (err: unknown) {
        console.warn("Failed to fetch /api/early-warning:", err);
      } finally {
        if (active) setIsLoading(false);
      }
    }
    loadEarlyWarning();
    return () => {
      active = false;
    };
  }, []);

  const fallbackHotspots = useMemo(() => (reports.length > 0 ? rankHotspots(reports) : []), [reports]);
  const hotspots = serverData?.hotspots ?? fallbackHotspots;

  // Calculate citywide totals by week by category
  const fallbackCitywide = useMemo(() => {
    const latestReportTime = reports.reduce((max, r) => {
      const t = r.createdAt ? new Date(r.createdAt).getTime() : 0;
      return t > max ? t : max;
    }, 0);
    const now = latestReportTime || 0;
    const citywide = [
      { week: "W-3" as const, total: 0, counts: {} as Record<string, number> },
      { week: "W-2" as const, total: 0, counts: {} as Record<string, number> },
      { week: "W-1" as const, total: 0, counts: {} as Record<string, number> },
      { week: "W0" as const, total: 0, counts: {} as Record<string, number> },
    ];

    for (const r of reports) {
      const ageMs = now - new Date(r.createdAt || now).getTime();
      const weekIndex = Math.floor(ageMs / (7 * 24 * 60 * 60 * 1000));
      if (weekIndex >= 0 && weekIndex < 4) {
        const w = 3 - weekIndex;
        const cat = r.hazard_category || "unknown";
        const weekData = citywide[w];
        if (weekData) {
          weekData.counts[cat] = (weekData.counts[cat] || 0) + 1;
          weekData.total++;
        }
      }
    }
    return citywide;
  }, [reports]);

  const citywideByWeekAndCategory = serverData?.citywide ?? fallbackCitywide;

  // Linear trend projection for next week (W+1)
  const projectedNextWeekTotal = useMemo(() => {
    if (!citywideByWeekAndCategory || citywideByWeekAndCategory.length < 4) return 0;
    const w3 = citywideByWeekAndCategory[0]?.total ?? 0;
    const w2 = citywideByWeekAndCategory[1]?.total ?? 0;
    const w1 = citywideByWeekAndCategory[2]?.total ?? 0;
    const w0 = citywideByWeekAndCategory[3]?.total ?? 0;
    return projectNextWeek([w0, w1, w2, w3]);
  }, [citywideByWeekAndCategory]);

  // Compute category breakdown from most recent week (W0)
  const w0CategoryBreakdown = useMemo(() => {
    const w0Counts = citywideByWeekAndCategory[3]?.counts || {};
    const totalW0 = citywideByWeekAndCategory[3]?.total || 1;
    return ALL_HAZARD_CATEGORIES.map((cat) => {
      const count = w0Counts[cat] || 0;
      const pct = Math.round((count / totalW0) * 100);
      return { cat, count, pct };
    }).sort((a, b) => b.count - a.count);
  }, [citywideByWeekAndCategory]);

  // Compute risk tier counts
  const riskCounts = useMemo(() => {
    const high = hotspots.filter((h) => h.risk === "high").length;
    const medium = hotspots.filter((h) => h.risk === "medium").length;
    const low = hotspots.filter((h) => h.risk === "low").length;
    return { high, medium, low, total: hotspots.length };
  }, [hotspots]);

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-400 space-y-3">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs">Computing statistical anomaly detection buckets from SQL...</p>
      </div>
    );
  }

  if (hotspots.length === 0 && reports.length < 5) {
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-slate-400">
        <div className="text-center p-6 bg-slate-950/80 rounded-xl border border-slate-800 max-w-md">
          <h3 className="font-bold text-slate-200 text-sm mb-1">Insufficient Historical Observations</h3>
          <p className="text-xs text-slate-400">Load synthetic demo data to evaluate 4-week moving anomaly detection.</p>
        </div>
      </div>
    );
  }

  const wardsOnWatch = hotspots.filter((h) => h.risk === "high" || h.risk === "medium").length;
  const projectedHazards = hotspots.reduce((sum, h) => sum + h.projection, 0);
  const highestRiskWard = hotspots.length > 0 ? hotspots[0]!.ward : "None";
  const highestRiskDomCategory = hotspots.length > 0 ? hotspots[0]!.dominant_category : "unknown";

  const riskColors = {
    high: "bg-red-500/20 text-red-400 border-red-500/50",
    medium: "bg-amber-500/20 text-amber-400 border-amber-500/50",
    low: "bg-emerald-500/20 text-emerald-400 border-emerald-500/50",
  };

  return (
    <div className="flex-1 bg-slate-900 overflow-y-auto p-5 space-y-6">
      {/* As-Of Header & Data Quality Disclosures */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div>
          <h2 className="text-base font-bold text-slate-100 uppercase tracking-wider">
            Early Warning & Hotspot Intelligence
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            4-week rolling statistical variance and z-score anomaly detection across MCD wards
          </p>
        </div>
        <div className="flex items-center gap-2">
          {serverData?.asOf && (
            <span className="text-[11px] font-mono bg-slate-950 text-slate-400 border border-slate-800 px-2.5 py-1 rounded">
              Data as of {new Date(serverData.asOf).toLocaleString()}
            </span>
          )}
          {typeof serverData?.unresolvedCount === "number" && (
            <span className="text-[11px] bg-amber-950/40 text-amber-300 border border-amber-800/60 px-2.5 py-1 rounded">
              {serverData.unresolvedCount} unmapped reports this week
            </span>
          )}
        </div>
      </div>

      {/* Summary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-1">
          <span className="text-[10px] text-slate-500 uppercase font-mono block">Wards on Watch</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{wardsOnWatch}</span>
            <span className="text-xs text-slate-400">flagged wards</span>
          </div>
          <div className="flex items-center gap-1.5 pt-1 text-[10px] font-mono">
            <span className="text-red-400">{riskCounts.high} High</span>
            <span className="text-slate-600">|</span>
            <span className="text-amber-400">{riskCounts.medium} Medium</span>
          </div>
        </div>

        <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-1">
          <span className="text-[10px] text-slate-500 uppercase font-mono block">Trend-Based Estimate (Next Week)</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-amber-400">{projectedHazards}</span>
            <span className="text-xs text-slate-400">sum of slopes</span>
          </div>
          <p className="text-[10px] text-slate-500 leading-tight pt-1">
            4-week linear extrapolation. Not an event probability.
          </p>
        </div>

        <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-1">
          <span className="text-[10px] text-slate-500 uppercase font-mono block">Highest Risk Ward</span>
          <div className="text-lg font-bold text-red-400 truncate" title={highestRiskWard}>
            {highestRiskWard}
          </div>
          <div className="text-[10px] text-slate-400 pt-1 truncate">
            Dominant: <span className="text-slate-300 font-medium">{humanizeCategory(highestRiskDomCategory)}</span>
          </div>
        </div>

        <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-1">
          <span className="text-[10px] text-slate-500 uppercase font-mono block">Anomaly Baseline Rules</span>
          <div className="text-base font-bold text-blue-400">R2 (MIN_HIGH=13)</div>
          <p className="text-[10px] text-slate-500 leading-tight pt-1">
            Validated via Monte Carlo backtest across seeds 1 to 5 (&lt;5% false alarm rate).
          </p>
        </div>
      </div>

      {/* Analytical Visualizations Row: Category Breakdown & Risk Tier Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Category Breakdown (W0 Observed) */}
        <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div>
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Current Week Category Distribution (W0)
              </h3>
              <p className="text-[10px] text-slate-400">
                Proportional breakdown of active road hazard incident volume
              </p>
            </div>
            <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
              Citywide: {citywideByWeekAndCategory[3]?.total || 0} reports
            </span>
          </div>

          <div className="space-y-2.5">
            {w0CategoryBreakdown.map((item) => (
              <div key={item.cat} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-xs" style={{ backgroundColor: catColors[item.cat] }}></span>
                    {getCategoryLabel(item.cat)}
                  </span>
                  <span className="font-mono text-slate-400 text-[11px]">
                    {item.count} reports ({item.pct}%)
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${item.pct}%`,
                      backgroundColor: catColors[item.cat],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Risk Classification Distribution */}
        <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-3">
          <div className="border-b border-slate-800/80 pb-2">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Risk Tier Classification
            </h3>
            <p className="text-[10px] text-slate-400">Statistical threshold distribution across watch list</p>
          </div>

          <div className="space-y-3 pt-1">
            <div className="p-2.5 rounded-lg bg-red-950/30 border border-red-900/50 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-red-400 block">High Risk Tier</span>
                <span className="text-[10px] text-slate-400">Score &ge; 2.0 and W0 &ge; 13</span>
              </div>
              <span className="text-xl font-bold font-mono text-red-400">{riskCounts.high}</span>
            </div>

            <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-900/50 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-amber-400 block">Medium Risk Tier</span>
                <span className="text-[10px] text-slate-400">Score &ge; 1.0 or (+50% change)</span>
              </div>
              <span className="text-xl font-bold font-mono text-amber-400">{riskCounts.medium}</span>
            </div>

            <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-900/50 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-emerald-400 block">Low Baseline Variation</span>
                <span className="text-[10px] text-slate-400">Within moving variation</span>
              </div>
              <span className="text-xl font-bold font-mono text-emerald-400">{riskCounts.low}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Ranked Hotspots Section */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 border-b border-slate-800/80 pb-2">
          <div>
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
              Ranked Municipal Hotspots
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Anomaly score: z-score against prior 3 weeks moving baseline. Scores indicate statistical deviation, not probabilities.
            </p>
          </div>
          <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
            {hotspots.length} flagged locations
          </span>
        </div>

        <div className="space-y-3">
          {hotspots.map((h, idx) => {
            const maxVal = Math.max(...h.sparkline, 1);
            const wPrev = h.sparkline[2] ?? 0;
            const wCurr = h.sparkline[3] ?? 0;
            const prior0 = h.sparkline[0] ?? 0;
            const prior1 = h.sparkline[1] ?? 0;
            const prior2 = h.sparkline[2] ?? 0;
            const meanVal = h.mean ?? (prior0 + prior1 + prior2) / 3;
            const sampleVar =
              (Math.pow(prior0 - meanVal, 2) + Math.pow(prior1 - meanVal, 2) + Math.pow(prior2 - meanVal, 2)) / 2;
            const stdVal = h.std ?? Math.sqrt(sampleVar);
            const scoreVal = h.score ?? h.anomaly_score;
            const baselineWeeks = h.baseline_weeks ?? 3;
            const thresholdText = getRuleThresholdText(h.risk);
            const whyFlagged = `${h.this_week} reports this week, ${baselineWeeks} baseline weeks used, threshold: ${thresholdText}`;

            return (
              <div
                key={h.ward}
                className="bg-slate-950/80 hover:bg-slate-950 rounded-xl p-4 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer shadow-sm space-y-3"
                onClick={() => onSelectWard(h.ward)}
              >
                {/* Hotspot Card Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 pb-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500 font-mono font-bold text-xs bg-slate-900 px-2 py-1 rounded border border-slate-800">
                      #{idx + 1}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-100 hover:text-blue-400 transition-colors">
                          {h.ward}
                        </span>
                        {h.area_landmark && (
                          <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800 truncate">
                            near {h.area_landmark}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold tracking-wider border ${riskColors[h.risk]}`}>
                      {h.risk} Risk
                    </span>
                    <span className="text-[10px] font-mono text-purple-300 bg-purple-950/40 border border-purple-800/60 px-2 py-0.5 rounded">
                      Proj: {h.projection}
                    </span>
                  </div>
                </div>

                {/* Hotspot Metric Columns */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs items-center">
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60">
                    <span className="text-[10px] text-slate-500 block">Observed This Week</span>
                    <span className="text-lg font-bold text-slate-100">{h.this_week}</span>
                    <span className="text-[10px] text-slate-500 block">incidents</span>
                  </div>

                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60">
                    <span className="text-[10px] text-slate-500 block">Week-over-Week</span>
                    <span className={`text-sm font-bold block ${h.pct_change >= 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {h.pct_change > 0 ? "+" : ""}{h.pct_change.toFixed(0)}%
                    </span>
                    <span className="text-[10px] text-slate-500 block">({wPrev} to {wCurr})</span>
                  </div>

                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60">
                    <span className="text-[10px] text-slate-500 block">Anomaly Score</span>
                    <span className="text-lg font-bold text-yellow-400 block">{scoreVal.toFixed(1)}</span>
                    <span className="text-[10px] text-slate-500 block">z-score</span>
                  </div>

                  {/* Sparkline Visual */}
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60 flex flex-col items-center justify-between">
                    <span className="text-[10px] text-slate-500 w-full text-left">4W Trajectory</span>
                    <div className="flex items-end gap-1.5 h-7 my-1">
                      {h.sparkline.map((val, i) => (
                        <div
                          key={i}
                          className="w-4 bg-blue-500/70 hover:bg-blue-400 rounded-xs transition-all"
                          style={{ height: `${Math.max(15, (val / maxVal) * 100)}%` }}
                          title={`Week -${3 - i}: ${val} incidents`}
                        />
                      ))}
                    </div>
                    <div className="flex gap-1 w-full justify-between text-[9px] text-slate-500 font-mono">
                      <span>W-3</span>
                      <span>W-2</span>
                      <span>W-1</span>
                      <span>W0</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60 col-span-2">
                    <span className="text-[10px] text-slate-500 block">Operations Task Force</span>
                    <span className="font-semibold text-slate-200 block truncate">{h.suggested_department}</span>
                    <span className="text-[10px] text-slate-400 block truncate mt-0.5">
                      Cause: {h.likely_cause}
                    </span>
                  </div>
                </div>

                {/* Flagged Rule Description Banner */}
                <div
                  className="text-[11px] text-slate-300 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800 flex items-center justify-between cursor-help"
                  title={`Statistical Flag: ${whyFlagged}`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-slate-400 font-mono text-[10px] uppercase font-bold">Flagged Rule:</span>
                    <span className="text-slate-200 truncate">{whyFlagged}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono shrink-0 ml-2">
                    Baseline: mean {meanVal.toFixed(1)}, std {stdVal.toFixed(1)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Citywide Trend Chart */}
      <div className="bg-slate-950/80 p-5 rounded-xl border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 border-b border-slate-800/80 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
              Citywide Incident Trend & Linear Extrapolation
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Cumulative weekly incident counts across 4 historical windows and projected next week
            </p>
          </div>
          {/* Chart Legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-blue-500 rounded-xs"></div>
              <span>Observed Incident Totals</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-xs border border-dashed border-slate-400 bg-slate-400/20"></div>
              <span>Trend Estimate (Not a Probability)</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="w-full flex-1">
            <svg viewBox="0 0 800 280" className="w-full h-72 bg-slate-900/90 rounded-xl border border-slate-800/80">
              {/* Grid Lines */}
              <line x1="50" y1="30" x2="760" y2="30" stroke="#1e293b" strokeWidth="1" strokeDasharray="3 3" />
              <line x1="50" y1="80" x2="760" y2="80" stroke="#1e293b" strokeWidth="1" strokeDasharray="3 3" />
              <line x1="50" y1="130" x2="760" y2="130" stroke="#1e293b" strokeWidth="1" strokeDasharray="3 3" />
              <line x1="50" y1="180" x2="760" y2="180" stroke="#1e293b" strokeWidth="1" strokeDasharray="3 3" />

              {/* Axes */}
              <line x1="50" y1="230" x2="760" y2="230" stroke="#475569" strokeWidth="1.5" />
              <line x1="50" y1="30" x2="50" y2="230" stroke="#475569" strokeWidth="1.5" />

              {(() => {
                const maxWeeklyTotal = Math.max(
                  ...citywideByWeekAndCategory.map((w) => w.total),
                  projectedNextWeekTotal,
                  1
                );
                const chartHeight = 190;
                const barWidth = 64;
                const totalPlotWidth = 710;
                const numBars = 5;
                const gap = (totalPlotWidth - numBars * barWidth) / (numBars + 1);

                // Render 4 observed bars
                const observedBars = citywideByWeekAndCategory.map((w, i) => {
                  const x = 50 + gap + i * (barWidth + gap);
                  const minTotalHeight = w.total > 0 ? 4 : 0;
                  let scaleHeight = (w.total / maxWeeklyTotal) * chartHeight;
                  if (scaleHeight < minTotalHeight) scaleHeight = minTotalHeight;

                  let yOffset = 230;
                  const activeCats = Object.keys(w.counts).sort();

                  const rects = activeCats.map((cat) => {
                    const count = w.counts[cat]!;
                    const rectHeight = (count / w.total) * scaleHeight;
                    yOffset -= rectHeight;
                    return (
                      <rect
                        key={cat}
                        x={x}
                        y={yOffset}
                        width={barWidth}
                        height={rectHeight}
                        fill={catColors[cat as HazardCategory] || catColors.unknown}
                      />
                    );
                  });

                  return (
                    <g key={w.week}>
                      {rects}
                      <text
                        x={x + barWidth / 2}
                        y={230 - scaleHeight - 8}
                        fill="#f8fafc"
                        fontSize="13"
                        textAnchor="middle"
                        fontWeight="bold"
                      >
                        {w.total > 0 ? w.total : ""}
                      </text>
                      <text x={x + barWidth / 2} y="250" fill="#94a3b8" fontSize="12" textAnchor="middle">
                        {w.week} (Obs)
                      </text>
                    </g>
                  );
                });

                // Render 1 projected bar (W+1)
                const projX = 50 + gap + 4 * (barWidth + gap);
                const projMinHeight = projectedNextWeekTotal > 0 ? 4 : 0;
                let projScaleHeight = (projectedNextWeekTotal / maxWeeklyTotal) * chartHeight;
                if (projScaleHeight < projMinHeight) projScaleHeight = projMinHeight;
                const projY = 230 - projScaleHeight;

                const projectedBar = (
                  <g key="W+1">
                    <rect
                      x={projX}
                      y={projY}
                      width={barWidth}
                      height={projScaleHeight}
                      fill="rgba(148, 163, 184, 0.2)"
                      stroke="#94a3b8"
                      strokeWidth="2"
                      strokeDasharray="5,5"
                      rx="3"
                    />
                    <text
                      x={projX + barWidth / 2}
                      y={projY - 8}
                      fill="#cbd5e1"
                      fontSize="13"
                      textAnchor="middle"
                      fontWeight="bold"
                    >
                      {projectedNextWeekTotal}
                    </text>
                    <text x={projX + barWidth / 2} y="250" fill="#94a3b8" fontSize="12" textAnchor="middle">
                      W+1 (Proj)
                    </text>
                  </g>
                );

                return (
                  <>
                    {observedBars}
                    {projectedBar}
                  </>
                );
              })()}
            </svg>
          </div>

          {/* Category Palette Key */}
          <div className="flex flex-col gap-2 shrink-0 bg-slate-900/90 p-4 rounded-xl border border-slate-800 w-full lg:w-56">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block mb-1">
              Hazard Color Palette
            </span>
            {ALL_HAZARD_CATEGORIES.map((cat: HazardCategory) => (
              <div key={cat} className="flex items-center gap-2 text-xs text-slate-300">
                <span className="w-2.5 h-2.5 rounded-xs" style={{ backgroundColor: catColors[cat] }}></span>
                <span>{getCategoryLabel(cat)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
