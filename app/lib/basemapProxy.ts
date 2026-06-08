import { NextResponse } from "next/server";

export async function proxyTile(url: string, fallbackContentType: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SentinelAmbiental/0.1 local-dev"
    },
    cache: "force-cache"
  });

  if (!response.ok) {
    return NextResponse.json(
      {
        error: "basemap_tile_error",
        upstreamStatus: response.status,
        upstreamUrl: url
      },
      { status: 502 }
    );
  }

  const contentType = response.headers.get("content-type") ?? fallbackContentType;
  const body = await response.arrayBuffer();

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
    }
  });
}

export function parseTileParams(params: { z: string; x: string; y: string }) {
  const z = Number(params.z);
  const x = Number(params.x);
  const y = Number(params.y);

  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > 22 || x < 0 || y < 0) {
    return null;
  }

  return { z, x, y };
}
