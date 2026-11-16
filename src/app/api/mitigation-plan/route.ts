import { NextResponse } from "next/server";
import { generateWeeklyPlan } from "@/lib/mitigation/service";

// In-memory rate limiter: max 5 non-cached generations per minute
let generationTimestamps: number[] = [];
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 5;

export async function POST(request: Request) {
  try {
    let force = false;
    try {
      const body = await request.json();
      if (body && typeof body.force === "boolean") {
        force = body.force;
      }
    } catch {
      // Empty or non-JSON body is valid, defaults to force: false
    }

    if (force) {
      const now = Date.now();
      generationTimestamps = generationTimestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (generationTimestamps.length >= MAX_PER_WINDOW) {
        return NextResponse.json(
          { error: "Rate limit exceeded. Maximum 5 live plan regenerations per minute." },
          { status: 429 }
        );
      }
      generationTimestamps.push(now);
    }

    const result = await generateWeeklyPlan({ force });
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("POST /api/mitigation-plan error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
