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

// Category colors and labels derived from schema enum in @/lib/categories
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
      { week: "W0" as const, total: 0, counts: {} as Record<string, number> }
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

  // Project next week total from 4 observed weeks
  const projectedNextWeekTotal = useMemo(() => {
    if (!citywideByWeekAndCategory || citywideByWeekAndCategory.length < 4) return 0;
    const w3 = citywideByWeekAndCategory[0]?.total ?? 0;
    const w2 = citywideByWeekAndCategory[1]?.total ?? 0;
    const w1 = citywideByWeekAndCategory[2]?.total ?? 0;
    const w0 = citywideByWeekAndCategory[3]?.total ?? 0;
    return projectNextWeek([w0, w1, w2, w3]);
  }, [citywideByWeekAndCategory]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-slate-400">
        <p>Loading early warning data from SQL...</p>
      </div>
    );
  }

  if (hotspots.length === 0 && reports.length < 5) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-slate-400">
        <p>Load demo data to see early warnings</p>
      </div>
    );
  }

  const wardsOnWatch = hotspots.filter(h => h.risk === "high" || h.risk === "medium").length;
  const projectedHazards = hotspots.reduce((sum, h) => sum + h.projection, 0);
  const highestRiskWard = hotspots.length > 0 ? hotspots[0]!.ward : "None";

  const riskColors = {
    high: "bg-red-500/20 text-red-400 border-red-500/50",
    medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/50",
    low: "bg-green-500/20 text-green-400 border-green-500/50"
  };

  return (
    <div className="flex-1 bg-slate-900 overflow-y-auto p-6 flex flex-col gap-6">
      {serverData?.asOf && (
        <div className="text-xs text-slate-500 -mb-2">
          Data as of {new Date(serverData.asOf).toLocaleString()}
        </div>
      )}
      {typeof serverData?.unresolvedCount === "number" && (
        <div className="text-xs text-slate-400 -mt-3">
          {serverData.unresolvedCount} reports this week could not be matched to a ward
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <div className="text-slate-400 text-sm">Wards on Watch</div>
          <div className="text-2xl font-bold text-white">{wardsOnWatch}</div>
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <div className="text-slate-400 text-sm">Trend-based Incident Estimate (Next Week)</div>
          <div className="text-xs text-slate-500 mt-0.5">Sum of each flagged ward&apos;s 4-week linear trend. Not a probability.</div>
          <div className="text-2xl font-bold text-orange-400 mt-1">{projectedHazards}</div>
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <div className="text-slate-400 text-sm">Highest Risk Ward</div>
          <div className="text-2xl font-bold text-red-400">{highestRiskWard}</div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="border-b border-slate-700 pb-2">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
            <h2 className="text-xl font-bold text-slate-200">Ranked Hotspots</h2>
            <div className="text-xs text-slate-400 font-medium">
              Anomaly score: z-score against the prior weeks, not a probability
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Four weekly buckets cannot show seasonality. Scores indicate statistical deviation.
          </div>
        </div>
        {hotspots.map((h, idx) => {
          const maxVal = Math.max(...h.sparkline, 1);
          const wPrev = h.sparkline[2];
          const wCurr = h.sparkline[3];
          const prior0 = h.sparkline[0] ?? 0;
          const prior1 = h.sparkline[1] ?? 0;
          const prior2 = h.sparkline[2] ?? 0;
          const meanVal = h.mean ?? (prior0 + prior1 + prior2) / 3;
          const sampleVar = (Math.pow(prior0 - meanVal, 2) + Math.pow(prior1 - meanVal, 2) + Math.pow(prior2 - meanVal, 2)) / 2;
          const stdVal = h.std ?? Math.sqrt(sampleVar);
          const scoreVal = h.score ?? h.anomaly_score;
          const baselineWeeks = h.baseline_weeks ?? 3;
          const thresholdText = getRuleThresholdText(h.risk);
          const whyFlagged = `${h.this_week} reports this week, ${baselineWeeks} baseline weeks used, threshold: ${thresholdText}`;

          return (
            <div key={h.ward} className="bg-slate-800 rounded-lg p-4 flex flex-col lg:flex-row gap-6 lg:items-center border border-slate-700 hover:border-slate-500 cursor-pointer transition-colors" onClick={() => onSelectWard(h.ward)}>
              <div className="flex items-center gap-4">
                <div className="text-slate-500 font-bold w-6 shrink-0">#{idx + 1}</div>
                <div className="w-56 shrink-0">
                  <div className="font-bold text-lg truncate" title={h.ward}>{h.ward}</div>
                  {h.area_landmark && <div className="text-xs text-slate-400 mt-0.5 truncate" title={`near ${h.area_landmark}`}>near {h.area_landmark}</div>}
                  <div className={`inline-block px-2 py-0.5 mt-1 rounded text-xs border ${riskColors[h.risk]}`}>
                    {h.risk.toUpperCase()}
                  </div>
                  <div className="text-xs text-slate-300 mt-2 p-1.5 rounded bg-slate-900/60 border border-slate-700/50 cursor-help" title={`Why flagged: ${whyFlagged}`}>
                    <span className="text-slate-400 font-semibold block">Flagged rule:</span>
                    <span className="text-slate-300">{whyFlagged}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:flex lg:flex-1 gap-6 items-center">
                <div className="w-36">
                  <div className="text-xs text-slate-400 mb-0.5">Observed this week</div>
                  <div className="text-2xl font-bold">{h.this_week}</div>
                  <div className="text-xs text-slate-400 mt-1.5 mb-0.5">Week-over-week change</div>
                  <div className={`text-sm ${h.pct_change >= 0 ? "text-red-400" : "text-green-400"}`}>
                    {h.pct_change > 0 ? "+" : ""}{h.pct_change.toFixed(0)}% ({wPrev} to {wCurr})
                  </div>
                </div>
                <div className="flex flex-col w-36 items-center">
                  <div className="flex items-end gap-1 h-12 mt-2">
                    {h.sparkline.map((val, i) => (
                      <div key={i} className="w-5 bg-blue-500/50 rounded-t" style={{ height: `${(val / maxVal) * 100}%` }} title={`Week -${3-i}: ${val}`}></div>
                    ))}
                  </div>
                  <div className="flex gap-1 w-full justify-between text-[10px] text-slate-500 mt-1">
                    <span>W-3</span><span>W-2</span><span>W-1</span><span>W0</span>
                  </div>
                  <div className="text-[10px] text-slate-500 text-center mt-1">
                    Baseline: {baselineWeeks} prior weeks, mean {meanVal.toFixed(1)}, std {stdVal.toFixed(1)}
                  </div>
                </div>
                <div className="w-28 text-center">
                  <div
                    title={`z-score against previous ${baselineWeeks} weeks, not a probability`}
                    className="text-slate-400 text-xs font-semibold cursor-help border-b border-dashed border-slate-600 inline-block mb-1"
                  >
                    Anomaly score
                  </div>
                  <div className="text-2xl font-bold text-yellow-400">
                    {scoreVal.toFixed(1)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">z-score</div>
                </div>
                <div className="w-36 text-center">
                  <div className="text-slate-400 text-xs uppercase font-bold tracking-wider mb-1">Trend projection</div>
                  <div className="text-3xl font-bold text-purple-400">{h.projection}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">linear est.</div>
                </div>
              </div>

              <div className="text-sm text-slate-300 grid grid-cols-2 gap-2 lg:w-64 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-700/60 pt-3 lg:pt-0 lg:pl-4">
                <div><span className="text-slate-500 text-xs">Dominant:</span> <br/>{humanizeCategory(h.dominant_category)}</div>
                <div><span className="text-slate-500 text-xs">Likely cause:</span> <br/>{h.likely_cause}</div>
                <div className="col-span-2"><span className="text-slate-500 text-xs">Suggested Dept:</span> <br/>{h.suggested_department}</div>
              </div>
            </div>
          );
        })}
        {hotspots.length === 0 && (
          <div className="text-center py-8 text-slate-500">No wards currently meet hotspot criteria.</div>
        )}
      </div>

      <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 mt-4 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-200">Citywide Trend (All Hazards)</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Weekly reported incidents across all 4 historical observation windows and next-week linear trend extrapolation.
            </p>
          </div>
          {/* Chart Legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300 bg-slate-950/60 px-3 py-1.5 rounded-md border border-slate-700">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-blue-500 rounded-sm"></div>
              <span>Observed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm border border-dashed border-slate-400 bg-slate-400/20"></div>
              <span>Trend estimate (not a probability)</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="w-full flex-1">
            <svg viewBox="0 0 800 280" className="w-full h-72 bg-slate-900 rounded border border-slate-800">
              {/* Grid Lines */}
              <line x1="50" y1="30" x2="760" y2="30" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
              <line x1="50" y1="80" x2="760" y2="80" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
              <line x1="50" y1="130" x2="760" y2="130" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
              <line x1="50" y1="180" x2="760" y2="180" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />

              {/* Axis */}
              <line x1="50" y1="230" x2="760" y2="230" stroke="#475569" strokeWidth="2" />
              <line x1="50" y1="30" x2="50" y2="230" stroke="#475569" strokeWidth="2" />
              
              {/* Bars: 4 observed weeks + 1 projected week */}
              {(() => {
                const maxWeeklyTotal = Math.max(
                  ...citywideByWeekAndCategory.map(w => w.total),
                  projectedNextWeekTotal,
                  1
                );
                const chartHeight = 190; // from 230 up to 40
                const barWidth = 60;
                const totalPlotWidth = 710; // 760 - 50
                const numBars = 5; // 4 observed + 1 projected
                const gap = (totalPlotWidth - (numBars * barWidth)) / (numBars + 1);
                
                // Render 4 observed bars
                const observedBars = citywideByWeekAndCategory.map((w, i) => {
                  const x = 50 + gap + i * (barWidth + gap);
                  const minTotalHeight = w.total > 0 ? 4 : 0;
                  let scaleHeight = (w.total / maxWeeklyTotal) * chartHeight;
                  if (scaleHeight < minTotalHeight) scaleHeight = minTotalHeight;
                  
                  let yOffset = 230;
                  const activeCats = Object.keys(w.counts).sort();
                  
                  const rects = activeCats.map(cat => {
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
                      <text x={x + barWidth/2} y={230 - scaleHeight - 7} fill="#f8fafc" fontSize="13" textAnchor="middle" fontWeight="bold">
                        {w.total > 0 ? w.total : ""}
                      </text>
                      <text x={x + barWidth/2} y="250" fill="#94a3b8" fontSize="12" textAnchor="middle">
                        {w.week}
                      </text>
                    </g>
                  );
                });

                // Render 1 projected bar (W+1)
                const projIndex = 4;
                const projX = 50 + gap + projIndex * (barWidth + gap);
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
                      fill="rgba(148, 163, 184, 0.25)"
                      stroke="#94a3b8"
                      strokeWidth="2"
                      strokeDasharray="5,5"
                      rx="3"
                    />
                    <text x={projX + barWidth/2} y={projY - 7} fill="#cbd5e1" fontSize="13" textAnchor="middle" fontWeight="bold">
                      {projectedNextWeekTotal}
                    </text>
                    <text x={projX + barWidth/2} y="250" fill="#94a3b8" fontSize="12" textAnchor="middle">
                      W+1 (proj)
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

          {/* Category breakdown legend */}
          <div className="flex flex-col gap-2 shrink-0 bg-slate-900/60 p-4 rounded-lg border border-slate-800">
            <div className="text-xs font-semibold text-slate-400 mb-1">Hazard Categories</div>
            {ALL_HAZARD_CATEGORIES.map((cat: HazardCategory) => (
              <div key={cat} className="flex items-center gap-2 text-xs text-slate-300">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: catColors[cat] }}></div>
                {getCategoryLabel(cat)}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      <div className="mt-auto pt-4 text-center text-xs text-slate-500">
        Anomaly detection on reported data. Projection is a simple trend extrapolation, not a trained forecasting model. Demo data.
      </div>
    </div>
  );
}
