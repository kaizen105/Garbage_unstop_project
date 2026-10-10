import { Report } from "@/lib/store/reports";
import { rankHotspots, weeklyBuckets, WardBucket } from "@/lib/early-warning/trends";
import { useMemo } from "react";

interface EarlyWarningPanelProps {
  reports: Report[];
  onSelectWard: (wardName: string) => void;
}

export function EarlyWarningPanel({ reports, onSelectWard }: EarlyWarningPanelProps) {
  const hotspots = useMemo(() => rankHotspots(reports), [reports]);
  
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

  // Calculate citywide totals by week by category
  const buckets = weeklyBuckets(reports);
  const citywide: [number, number, number, number] = [0, 0, 0, 0];
  for (const b of Object.values(buckets) as WardBucket[]) {
    for (let i = 0; i < 4; i++) {
      const idx = i as 0 | 1 | 2 | 3;
      citywide[idx] = (citywide[idx] || 0) + (b.counts[idx] || 0);
    }
  }

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
                <div className="font-bold text-lg">{h.ward}</div>
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
                <div><span className="text-slate-500">Dominant:</span> <br/>{h.dominant_category}</div>
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
        <div className="flex items-end gap-8 h-32 pl-4">
          {citywide.map((val, i) => {
            const maxVal = Math.max(...citywide, 1);
            return (
              <div key={i} className="flex flex-col items-center flex-1">
                <div className="w-full max-w-[60px] bg-slate-600 rounded-t relative group flex items-end justify-center" style={{ height: `${(val / maxVal) * 100}%` }}>
                  <span className="mb-2 font-bold text-white text-xs z-10">{val}</span>
                </div>
                <div className="mt-2 text-xs text-slate-400">Week -{3-i}</div>
              </div>
            )
          })}
        </div>
      </div>
      
      <div className="mt-auto pt-6 text-center text-xs text-slate-500">
        Anomaly detection on reported data. Projection is a simple trend extrapolation, not a trained forecasting model. Demo data.
      </div>
    </div>
  );
}
