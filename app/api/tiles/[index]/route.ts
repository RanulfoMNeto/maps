import { NextRequest, NextResponse } from "next/server";
import { spectralIndexSchema } from "@/app/lib/schema";

const layerEnv: Record<string, string | undefined> = {
  ndvi: process.env.SENTINELHUB_LAYER_NDVI,
  ndmi: process.env.SENTINELHUB_LAYER_NDMI,
  mndwi: process.env.SENTINELHUB_LAYER_MNDWI,
  nbr: process.env.SENTINELHUB_LAYER_NBR,
  dnbr: process.env.SENTINELHUB_LAYER_DNBR,
  bsi: process.env.SENTINELHUB_LAYER_BSI,
  ndre: process.env.SENTINELHUB_LAYER_NDRE
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ index: string }> }
) {
  const { index } = await context.params;
  const parsed = spectralIndexSchema.safeParse(index);
  const baseUrl = process.env.SENTINELHUB_WMS_BASE_URL;
  const layer = layerEnv[index];

  if (!parsed.success || !baseUrl || !layer) {
    return NextResponse.json(
      {
        error: "tile_layer_unavailable",
        message: "Configure SENTINELHUB_WMS_BASE_URL e a camada do índice solicitado."
      },
      { status: 503 }
    );
  }

  const incoming = request.nextUrl.searchParams;
  const params = new URLSearchParams({
    service: incoming.get("service") ?? "WMS",
    request: incoming.get("request") ?? "GetMap",
    version: incoming.get("version") ?? "1.1.1",
    layers: layer,
    styles: incoming.get("styles") ?? "",
    format: incoming.get("format") ?? "image/png",
    transparent: incoming.get("transparent") ?? "true",
    srs: incoming.get("srs") ?? incoming.get("crs") ?? "EPSG:3857",
    width: incoming.get("width") ?? "256",
    height: incoming.get("height") ?? "256",
    bbox: incoming.get("bbox") ?? "",
    time: `${incoming.get("dateFrom") ?? ""}/${incoming.get("dateTo") ?? ""}`
  });

  const upstream = await fetch(`${baseUrl}?${params.toString()}`, {
    headers: {
      "Cache-Control": "public, max-age=3600"
    }
  });

  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: "sentinel_tile_error",
        message: `Sentinel Hub retornou HTTP ${upstream.status}.`
      },
      { status: upstream.status }
    );
  }

  const bytes = await upstream.arrayBuffer();
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/png",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
