import { NextResponse } from "next/server";
import { geojsonDownload } from "@/app/lib/export";
import { analysisRequestSchema } from "@/app/lib/schema";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = analysisRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const format = new URL(request.url).searchParams.get("format") ?? "geojson";

    if (format !== "geojson") {
      return NextResponse.json(
        {
          error: "format_unavailable",
          message:
            "GeoTIFF, PNG, CSV e PDF exigem provedor externo e rotinas de processamento configuradas. GeoJSON está disponível para a AOI."
        },
        { status: 501 }
      );
    }

    return new Response(geojsonDownload(parsed.data), {
      headers: {
        "Content-Type": "application/geo+json",
        "Content-Disposition": "attachment; filename=sentinel-aoi.geojson"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "export_failed",
        message: error instanceof Error ? error.message : "Erro desconhecido na exportação."
      },
      { status: 500 }
    );
  }
}
