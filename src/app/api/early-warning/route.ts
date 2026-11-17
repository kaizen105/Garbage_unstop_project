import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getEarlyWarningData } from "@/lib/early-warning/sqlBuckets";

export async function GET() {
  await connection();
  try {
    const data = await getEarlyWarningData(new Date());
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error("[API early-warning GET error]:", error);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Failed to fetch early warning data" },
      { status: 500 }
    );
  }
}
