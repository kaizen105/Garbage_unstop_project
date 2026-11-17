import { NextResponse } from "next/server";
import { connection } from "next/server";
import { listReports } from "@/lib/reports/service";

export async function GET(request: Request) {
  await connection();
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const cursor = searchParams.get("cursor") || undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    const reports = await listReports({ limit, cursor });
    const nextCursor = reports.length >= (limitParam ? Math.min(Math.max(1, limit), 200) : 50)
      ? reports[reports.length - 1]?.report_id ?? null
      : null;

    return NextResponse.json({ reports, nextCursor });
  } catch (error: unknown) {
    console.error("[API reports GET error]:", error);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Failed to fetch reports" },
      { status: 500 }
    );
  }
}
