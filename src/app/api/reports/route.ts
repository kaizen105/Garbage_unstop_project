import { NextResponse } from "next/server";
import { connection } from "next/server";
import { listReports, ListReportsQuerySchema } from "@/lib/reports/service";

export async function GET(request: Request) {
  await connection();
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery: Record<string, string> = {};
    if (searchParams.has("limit")) {
      rawQuery.limit = searchParams.get("limit")!;
    }
    if (searchParams.has("cursor")) {
      rawQuery.cursor = searchParams.get("cursor")!;
    }

    const parseResult = ListReportsQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "Invalid query parameters" },
        { status: 400 }
      );
    }

    const { limit, cursor } = parseResult.data;

    const reports = await listReports({ limit, cursor });
    const nextCursor = reports.length >= limit
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
