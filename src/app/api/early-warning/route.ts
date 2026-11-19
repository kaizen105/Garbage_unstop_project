import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getEarlyWarningData } from "@/lib/early-warning/sqlBuckets";
import { getAsOf } from "@/lib/asOf";

export async function GET() {
  await connection();
  try {
    const asOf = await getAsOf();
    const data = await getEarlyWarningData(asOf);
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error("[API early-warning GET error]:", error);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Failed to fetch early warning data" },
      { status: 500 }
    );
  }
}
