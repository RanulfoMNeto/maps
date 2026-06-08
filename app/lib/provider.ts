import {
  AnalysisRequest,
  AnalysisResponse,
  INDEX_LEGENDS,
  INDEX_OPTIONS,
  buildUnavailableIndicators,
  buildUnavailableLayers
} from "./indices";
import { buildIndicators, buildProcessTileUrl, fetchTimeSeries, hasSentinelHubCredentials } from "./sentinelHub";

export function getProviderStatus() {
  return {
    sentinelHubReady: hasSentinelHubCredentials(),
    geeReady: Boolean(process.env.GOOGLE_EARTH_ENGINE_SERVICE_ACCOUNT && process.env.GOOGLE_EARTH_ENGINE_PRIVATE_KEY)
  };
}

export async function analyzeWithProvider(request: AnalysisRequest): Promise<AnalysisResponse> {
  const providerStatus = getProviderStatus();
  const now = new Date().toISOString();

  if (!providerStatus.sentinelHubReady) {
    return {
      provider: "not_configured",
      providerStatus: "provider_unconfigured",
      validationStatus: "indicative_not_validated",
      generatedAt: now,
      message:
        "Nenhum provedor Sentinel está configurado. A aplicação não gera métricas fictícias; configure Sentinel Hub ou Google Earth Engine para obter mapas e séries reais.",
      layers: buildUnavailableLayers(request.selectedIndices),
      indicators: buildUnavailableIndicators(),
      timeSeries: [],
      exports: {
        geotiff: false,
        png: false,
        csv: false,
        geojson: true,
        pdf: false
      }
    };
  }

  const timeSeries = await fetchTimeSeries(request);
  const layers = request.selectedIndices.map((index) => ({
    index,
    label: INDEX_OPTIONS[index].label,
    tileUrl: buildProcessTileUrl(index, request),
    legend: INDEX_LEGENDS[index],
    available: true
  }));

  return {
    provider: "sentinel_hub",
    providerStatus: "ready",
    validationStatus: "indicative_not_validated",
    generatedAt: now,
    message:
      "Índices calculados em Sentinel-2 L2A via Sentinel Hub Process API e Statistical API, com máscara SCL para nuvem/sombra. Mapas permanecem indicativos, não validados em campo.",
    layers,
    indicators: buildIndicators(timeSeries),
    timeSeries,
    exports: {
      geotiff: false,
      png: layers.some((layer) => layer.available),
      csv: timeSeries.length > 0,
      geojson: true,
      pdf: false
    }
  };
}
