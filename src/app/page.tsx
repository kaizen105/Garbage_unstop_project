"use client";

import { VoiceReporter } from "@/components/voice/VoiceReporter";
import { useReports } from "@/lib/store/reports";
import dynamic from "next/dynamic";
import { useState } from "react";

const HazardMap = dynamic(() => import("@/components/map/HazardMap").then(m => m.HazardMap), { ssr: false });

export default function Dashboard() {
  const { reports, loadDemoData, clearReports } = useReports();
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  const total = reports.length;
  const highSev = reports.filter(r => r.severity_level >= 7).length;
  const avgSev = total > 0 ? (reports.reduce((a, b) => a + b.severity_level, 0) / total).toFixed(1) : "0.0";
  const hazmat = reports.filter(r => r.action_required.includes("hazmat")).length;

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100 overflow-hidden">
      <header className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-red-500">SafaiKavach</h1>
          <p className="text-sm text-slate-400">Hear the hazard before it hurts.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadDemoData} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors">Load Demo Data</button>
          <button onClick={clearReports} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors">Clear</button>
        </div>
      </header>

      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        <div className="w-full md:w-[380px] flex flex-col border-r border-slate-800 bg-slate-900 overflow-y-auto">
          <div className="p-4 border-b border-slate-800 shrink-0">
            <VoiceReporter />
          </div>
          
          <div className="p-4 flex-1">
            <h2 className="text-lg font-semibold mb-4 text-slate-200">Recent Reports</h2>
            <div className="space-y-3">
              {reports.map(r => (
                <div 
                  key={r.report_id} 
                  className={`p-3 rounded border cursor-pointer transition-colors ${selectedReportId === r.report_id ? 'bg-slate-800 border-red-500' : 'bg-slate-950 border-slate-800 hover:border-slate-600'}`}
                  onClick={() => setSelectedReportId(r.report_id)}
                >
                  <div className="flex justify-between items-start">
                    <span className="font-mono text-xs text-slate-400">{r.report_id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${r.severity_level >= 7 ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>Sev {r.severity_level}</span>
                  </div>
                  <h3 className="font-medium mt-1 truncate">{r.hazard_category}</h3>
                  <p className="text-sm text-slate-500 truncate">{r.raw_location}</p>
                </div>
              ))}
              {reports.length === 0 && (
                <div className="text-center text-slate-500 text-sm py-8">No reports yet</div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col bg-slate-800 min-h-0">
          <div className="flex p-3 bg-slate-950 gap-4 text-sm border-b border-slate-800 shrink-0 flex-wrap">
            <div>Total: <span className="font-bold text-white">{total}</span></div>
            <div>High Sev: <span className="font-bold text-red-400">{highSev}</span></div>
            <div>Avg Sev: <span className="font-bold text-yellow-400">{avgSev}</span></div>
            <div>Hazmat: <span className="font-bold text-orange-400">{hazmat}</span></div>
          </div>
          <div className="flex-1 relative z-0">
            <HazardMap selectedReportId={selectedReportId} onSelectReport={setSelectedReportId} />
          </div>
        </div>
      </div>
    </div>
  );
}
