import { NextRequest, NextResponse } from "next/server";
import { fetchProcessTile, TilePalette } from "@/app/lib/sentinelHub";
import { spectralIndexSchema } from "@/app/lib/schema";

type Params = {
  index: string;
  z: string;
  x: string;
  y: string;
};

export async function GET(request: NextRequest, context: { params: Promise<Params> }) {
  const params = await context.params;
  const parsedIndex = spectralIndexSchema.safeParse(params.index);
  const z = Number(params.z);
  const x = Number(params.x);
  const y = Number(params.y);

  if (!parsedIndex.success || !Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
    return NextResponse.json({ error: "invalid_tile_request" }, { status: 400 });
  }

  const search = request.nextUrl.searchParams;
  const dateFrom = search.get("dateFrom");
  const dateTo = search.get("dateTo");
  const cloudCoverMax = Number(search.get("cloudCoverMax") ?? "30");

  if (!dateFrom || !dateTo || !Number.isFinite(cloudCoverMax)) {
    return NextResponse.json(
      { error: "invalid_tile_filters", message: "Informe dateFrom, dateTo e cloudCoverMax." },
      { status: 400 }
    );
  }

  try {
    const tile = await fetchProcessTile({
      index: parsedIndex.data,
      bbox: xyzToBbox(x, y, z),
      dateFrom,
      dateTo,
      cloudCoverMax,
      compareFrom: search.get("compareFrom") ?? undefined,
      compareTo: search.get("compareTo") ?? undefined,
      palette: parsePalette(search)
    });

    return new NextResponse(tile, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "sentinel_tile_error",
        message: error instanceof Error ? error.message : "Erro desconhecido ao gerar tile Sentinel."
      },
      { status: 502 }
    );
  }
}

function parsePalette(search: URLSearchParams): TilePalette | undefined {
  const colors = [search.get("c0"), search.get("c1"), search.get("c2"), search.get("c3")];

  if (colors.some((color) => !color)) {
    return undefined;
  }

  if (!colors.every((color) => color && /^#[0-9a-f]{6}$/i.test(color))) {
    return undefined;
  }

  return {
    low: colors[0] as string,
    midLow: colors[1] as string,
    midHigh: colors[2] as string,
    high: colors[3] as string
  };
}

function xyzToBbox(x: number, y: number, z: number): [number, number, number, number] {
  const west = tileToLon(x, z);
  const east = tileToLon(x + 1, z);
  const north = tileToLat(y, z);
  const south = tileToLat(y + 1, z);
  return [west, south, east, north];
}

function tileToLon(x: number, z: number) {
  return (x / 2 ** z) * 360 - 180;
}

function tileToLat(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}
