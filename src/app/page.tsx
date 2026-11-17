import { Suspense } from "react";
import { connection } from "next/server";
import { listReports } from "@/lib/reports/service";
import { ReportsProvider } from "@/lib/store/reports";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

async function DashboardWithData() {
  // Next.js 16 Dynamic Data tracking under Cache Components / Partial Prerendering
  await connection();
  const reports = await listReports({ limit: 50 });

  return (
    <ReportsProvider initialReports={reports}>
      <DashboardClient />
    </ReportsProvider>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-slate-900 text-slate-300">
          Loading SafaiKavach Dashboard...
        </div>
      }
    >
      <DashboardWithData />
    </Suspense>
  );
}
