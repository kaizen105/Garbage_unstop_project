import { NextResponse } from "next/server";
import { fetchRoute } from "@/lib/routing/router";
import { z } from "zod";

const RouteSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

export async function POST(request: Request) {
  try {
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "Invalid payload" },
        { status: 400 }
      );
    }

    const parseResult = RouteSchema.safeParse(json);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "Invalid payload" },
        { status: 400 }
      );
    }

    const { lat, lng } = parseResult.data;
    const routes = await fetchRoute({ lat, lng });
    return NextResponse.json(routes);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "Invalid payload" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
