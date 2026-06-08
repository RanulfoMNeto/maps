import { NextRequest, NextResponse } from "next/server";
import { fetchTrueColorTile } from "@/app/lib/sentinelHub";

type Params = {
  z: string;
  x: string;
  y: string;
};

export async function GET(request: NextRequest, context: { params: Promise<Params> }) {
  const params = await context.params;
  const z = Number(params.z);
  const x = Number(params.x);
  const y = Number(params.y);
  const search = request.nextUrl.searchParams;
  const dateFrom = search.get("dateFrom");
  const dateTo = search.get("dateTo");
  const cloudCoverMax = Number(search.get("cloudCoverMax") ?? "30");

  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || !dateFrom || !dateTo) {
    return NextResponse.json({ error: "invalid_sentinel_basemap_request" }, { status: 400 });
  }

  if (z < 7) {
    return new NextResponse(transparentPng(), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400"
      }
    });
  }

  try {
    const tile = await fetchTrueColorTile({
      bbox: xyzToBbox(x, y, z),
      dateFrom,
      dateTo,
      cloudCoverMax
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
        error: "sentinel_basemap_error",
        message: error instanceof Error ? error.message : "Erro desconhecido ao gerar Sentinel RGB."
      },
      { status: 502 }
    );
  }
}

function transparentPng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
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
