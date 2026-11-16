"use client";

import React, { createContext, useContext, useState, useTransition } from "react";
import type { WardTag } from "../validation/schemas";
import { resetSyntheticData } from "@/app/actions/reports";

export interface Report {
  report_id: string;
  hazard_category: string;
  severity_level: number;
  raw_location: string;
  coordinates: { lat: number; lng: number } | null;
  action_required: string;
  ward?: WardTag;
  createdAt?: string;
  transcript?: string;
  translated_english?: string | null;
}

interface ReportsContextType {
  reports: Report[];
  addReport: (report: Report) => void;
  loadDemoData: () => Promise<void>;
  resetView: () => void;
  isResetting: boolean;
}

const ReportsContext = createContext<ReportsContextType | undefined>(undefined);

export function ReportsProvider({
  children,
  initialReports = [],
}: {
  children: React.ReactNode;
  initialReports?: Report[];
}) {
  const [reports, setReports] = useState<Report[]>(initialReports);
  const [isResetting, startTransition] = useTransition();

  const addReport = (report: Report) => {
    setReports((prev) => [report, ...prev]);
  };

  const loadDemoData = async () => {
    startTransition(async () => {
      const res = await resetSyntheticData();
      if (!res.ok) {
        console.warn("[ReportsProvider] resetSyntheticData error:", res.error);
        alert(res.error);
        return;
      }
      // Trigger a page refresh to fetch the freshly seeded reports
      window.location.reload();
    });
  };

  /**
   * Resets local view state to the initial server-provided reports.
   * Does not pretend to delete database records.
   */
  const resetView = () => {
    setReports(initialReports);
  };

  return (
    <ReportsContext.Provider
      value={{
        reports,
        addReport,
        loadDemoData,
        resetView,
        isResetting,
      }}
    >
      {children}
    </ReportsContext.Provider>
  );
}

export function useReports() {
  const context = useContext(ReportsContext);
  if (!context) throw new Error("useReports must be used within a ReportsProvider");
  return context;
}
