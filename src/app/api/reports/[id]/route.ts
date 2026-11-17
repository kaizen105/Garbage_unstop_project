import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getReportById } from "@/lib/reports/service";

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  await connection();
  try {
    const { id } = await props.params;
    if (!id) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "Report ID required" }, { status: 400 });
    }

    const report = await getReportById(id);
    if (!report) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Report not found" }, { status: 404 });
    }

    return NextResponse.json({ report });
  } catch (error: unknown) {
    console.error("[API reports/:id GET error]:", error);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Failed to fetch report" },
      { status: 500 }
    );
  }
}
