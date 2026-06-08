import { NextResponse } from "next/server";
import { analyzeWithProvider } from "@/app/lib/provider";
import { analysisRequestSchema } from "@/app/lib/schema";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = analysisRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "invalid_request",
          details: parsed.error.flatten()
        },
        { status: 400 }
      );
    }

    const result = await analyzeWithProvider(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: "analysis_failed",
        message: error instanceof Error ? error.message : "Erro desconhecido ao processar análise."
      },
      { status: 500 }
    );
  }
}
