import { NextResponse } from "next/server";
import { listReports } from "@/lib/reports/service";

export async function GET() {
  try {
    const reports = await listReports();
    return NextResponse.json({ reports });
  } catch (error: unknown) {
    console.error("[API reports GET error]:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Failed to fetch reports" }, { status: 500 });
  }
}
