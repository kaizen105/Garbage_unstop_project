import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export interface HealthResponse {
  reachable: boolean;
  wardCount: number;
  reportCount: number;
  demoResetEnabled: boolean;
}

export async function GET() {
  const demoResetEnabled = process.env.ENABLE_DEMO_RESET === "true";

  try {
    const [wardCount, reportCount] = await Promise.all([
      prisma.ward.count(),
      prisma.report.count(),
    ]);

    const res: HealthResponse = {
      reachable: true,
      wardCount,
      reportCount,
      demoResetEnabled,
    };
    return NextResponse.json(res);
  } catch {
    const res: HealthResponse = {
      reachable: false,
      wardCount: 0,
      reportCount: 0,
      demoResetEnabled,
    };
    return NextResponse.json(res, { status: 200 });
  }
}
