import { NextRequest, NextResponse } from "next/server";
import { queryStandardCarGeoJson, StandardCarError } from "@/app/lib/standardCarServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FEATURES = 1500;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const stateId = searchParams.get("state") ?? "";
  const layerId = searchParams.get("layer") ?? "";
  const bbox = parseBbox(searchParams.get("bbox"));

  if (!stateId || !layerId || !bbox) {
    return NextResponse.json(
      { message: "Parâmetros obrigatórios: state, layer e bbox=west,south,east,north." },
      { status: 400 }
    );
  }

  const limit = clampNumber(Number(searchParams.get("limit") ?? 800), 1, MAX_FEATURES);
  const simplify = clampNumber(Number(searchParams.get("simplify") ?? 0), 0, 0.01);
  const municipality = searchParams.get("municipality")?.trim() || undefined;

  try {
    const geojson = await queryStandardCarGeoJson({
      stateId,
      layerId,
      bbox,
      municipality,
      limit,
      simplify
    });

    return new NextResponse(geojson, {
      headers: {
        "Cache-Control": "public, max-age=30",
        "Content-Type": "application/geo+json; charset=utf-8"
      }
    });
  } catch (error) {
    if (error instanceof StandardCarError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    return NextResponse.json({ message: "Falha ao consultar camada estadual do CAR." }, { status: 500 });
  }
}

function parseBbox(value: string | null): [number, number, number, number] | null {
  if (!value) {
    return null;
  }

  const parsed = value.split(",").map((part) => Number(part));
  if (parsed.length !== 4 || parsed.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [west, south, east, north] = parsed;
  if (west >= east || south >= north || west < -180 || east > 180 || south < -90 || north > 90) {
    return null;
  }

  return [west, south, east, north];
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
