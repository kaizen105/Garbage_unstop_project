"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import seedData from "../../data/seed_reports";

export interface Report {
  report_id: string;
  hazard_category: string;
  severity_level: number;
  raw_location: string;
  coordinates: { lat: number; lng: number } | null;
  action_required: string;
  ward: unknown;
}

interface ReportsContextType {
  reports: Report[];
  addReport: (report: Report) => void;
  loadDemoData: () => void;
  clearReports: () => void;
}

const ReportsContext = createContext<ReportsContextType | undefined>(undefined);

export function ReportsProvider({ children }: { children: React.ReactNode }) {
  const [reports, setReports] = useState<Report[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("safaikavach_reports");
      if (stored) setReports(JSON.parse(stored));
    } catch {}
  }, []);

  const addReport = (report: Report) => {
    setReports(prev => {
      const next = [report, ...prev];
      try { localStorage.setItem("safaikavach_reports", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const loadDemoData = () => {
    setReports(seedData as unknown as Report[]);
    try { localStorage.setItem("safaikavach_reports", JSON.stringify(seedData)); } catch {}
  };

  const clearReports = () => {
    setReports([]);
    try { localStorage.removeItem("safaikavach_reports"); } catch {}
  };

  return (
    <ReportsContext.Provider value={{ reports, addReport, loadDemoData, clearReports }}>
      {children}
    </ReportsContext.Provider>
  );
}

export function useReports() {
  const context = useContext(ReportsContext);
  if (!context) throw new Error("useReports must be used within a ReportsProvider");
  return context;
}
