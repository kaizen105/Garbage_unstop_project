import { Report } from "@/lib/store/reports";
import { rankHotspots } from "@/lib/early-warning/trends";
import { useMemo } from "react";
import { humanizeCategory } from "@/lib/utils/format";

interface EarlyWarningPanelProps {
  reports: Report[];
  onSelectWard: (wardName: string) => void;
}

const catColors: Record<string, string> = {
  construction_debris: "#94a3b8",
  biohazard_medical: "#ef4444",
  general_overflow: "#eab308",
  chemical: "#a855f7",
  electrical_hazard: "#f97316",
  unknown: "#64748b",
  dead_animal: "#14b8a6",
};

export function EarlyWarningPanel({ reports, onSelectWard }: EarlyWarningPanelProps) {
  const hotspots = useMemo(() => rankHotspots(reports), [reports]);
  
  // Calculate citywide totals by week by category
  const citywideByWeekAndCategory = useMemo(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/purity
    const now = Date.now();
    const citywide = [
      { week: "W-3", total: 0, counts: {} as Record<string, number> },
      { week: "W-2", total: 0, counts: {} as Record<string, number> },
      { week: "W-1", total: 0, counts: {} as Record<string, number> },
      { week: "W0", total: 0, counts: {} as Record<string, number> }
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

  if (reports.length < 5) {
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
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <div className="text-slate-400 text-sm">Wards on Watch</div>
          <div className="text-2xl font-bold text-white">{wardsOnWatch}</div>
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <div className="text-slate-400 text-sm">Projected Hotspot Hazards (Next Week)</div>
          <div className="text-2xl font-bold text-orange-400">{projectedHazards}</div>
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <div className="text-slate-400 text-sm">Highest Risk Ward</div>
          <div className="text-2xl font-bold text-red-400">{highestRiskWard}</div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-bold text-slate-200 border-b border-slate-700 pb-2">Ranked Hotspots</h2>
        {hotspots.map((h, idx) => {
          const maxVal = Math.max(...h.sparkline, 1);
          return (
            <div key={h.ward} className="bg-slate-800 rounded-lg p-4 flex gap-6 items-center border border-slate-700 hover:border-slate-500 cursor-pointer transition-colors" onClick={() => onSelectWard(h.ward)}>
              <div className="text-slate-500 font-bold w-6">#{idx + 1}</div>
              <div className="w-48">
                <div className="font-bold text-lg truncate" title={h.ward}>{h.ward}</div>
                {h.area_landmark && <div className="text-xs text-slate-400 mt-0.5 truncate" title={`near ${h.area_landmark}`}>near {h.area_landmark}</div>}
                <div className={`inline-block px-2 py-0.5 mt-1 rounded text-xs border ${riskColors[h.risk]}`}>
                  {h.risk.toUpperCase()}
                </div>
              </div>
              <div className="w-32">
                <div className="text-2xl font-bold">{h.this_week}</div>
                <div className={`text-sm ${h.pct_change >= 0 ? "text-red-400" : "text-green-400"}`}>
                  {h.pct_change > 0 ? "+" : ""}{h.pct_change.toFixed(0)}% this week
                </div>
              </div>
              <div className="flex flex-col w-32 items-center">
                <div className="flex items-end gap-1 h-12 mt-2">
                  {h.sparkline.map((val, i) => (
                    <div key={i} className="w-5 bg-blue-500/50 rounded-t" style={{ height: `${(val / maxVal) * 100}%` }} title={`Week -${3-i}: ${val}`}></div>
                  ))}
                </div>
                <div className="flex gap-1 w-full justify-between text-[10px] text-slate-500 mt-1">
                  <span>W-3</span><span>W-2</span><span>W-1</span><span>W0</span>
                </div>
              </div>
              <div className="flex-1 text-sm text-slate-300 grid grid-cols-2 gap-2">
                <div><span className="text-slate-500">Dominant:</span> <br/>{humanizeCategory(h.dominant_category)}</div>
                <div><span className="text-slate-500">Likely cause:</span> <br/>{h.likely_cause}</div>
                <div className="col-span-2"><span className="text-slate-500">Suggested Dept:</span> {h.suggested_department}</div>
              </div>
              <div className="w-24 text-center">
                <div className="text-slate-500 text-xs uppercase font-bold tracking-wider mb-1">Proj. (W+1)</div>
                <div className="text-3xl font-bold text-purple-400">{h.projection}</div>
              </div>
            </div>
          );
        })}
        {hotspots.length === 0 && (
          <div className="text-center py-8 text-slate-500">No wards currently meet hotspot criteria.</div>
        )}
      </div>

      <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 mt-4">
        <h3 className="text-lg font-bold text-slate-200 mb-4">Citywide Trend (All Hazards)</h3>
        <div className="flex gap-8 items-start">
          <svg width="400" height="200" className="bg-slate-900 rounded">
            {/* Axis */}
            <line x1="40" y1="160" x2="380" y2="160" stroke="#475569" strokeWidth="2" />
            <line x1="40" y1="20" x2="40" y2="160" stroke="#475569" strokeWidth="2" />
            
            {/* Bars */}
            {(() => {
              const maxWeeklyTotal = Math.max(...citywideByWeekAndCategory.map(w => w.total), 1);
              const chartHeight = 140; // 160 - 20
              const barWidth = 40;
              const gap = (340 - (4 * barWidth)) / 5; // spacing
              
              return citywideByWeekAndCategory.map((w, i) => {
                const x = 40 + gap + i * (barWidth + gap);
                // Minimum bar height logic: total height must be at least 4px if total > 0
                const minTotalHeight = w.total > 0 ? 4 : 0;
                let scaleHeight = (w.total / maxWeeklyTotal) * chartHeight;
                if (scaleHeight < minTotalHeight) scaleHeight = minTotalHeight;
                
                let yOffset = 160;
                
                // Sort categories to have consistent stacking order
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
                      fill={catColors[cat] || catColors.unknown} 
                    />
                  );
                });
                
                return (
                  <g key={i}>
                    {rects}
                    <text x={x + barWidth/2} y={160 - scaleHeight - 5} fill="#f8fafc" fontSize="12" textAnchor="middle" fontWeight="bold">
                      {w.total > 0 ? w.total : ""}
                    </text>
                    <text x={x + barWidth/2} y="175" fill="#94a3b8" fontSize="12" textAnchor="middle">
                      {w.week}
                    </text>
                  </g>
                );
              });
            })()}
          </svg>
          <div className="flex flex-col gap-2">
            {Object.keys(catColors).map(cat => (
              <div key={cat} className="flex items-center gap-2 text-xs text-slate-300">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: catColors[cat] }}></div>
                {humanizeCategory(cat)}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      <div className="mt-auto pt-6 text-center text-xs text-slate-500">
        Anomaly detection on reported data. Projection is a simple trend extrapolation, not a trained forecasting model. Demo data.
      </div>
    </div>
  );
}
