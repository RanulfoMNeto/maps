import { AnalysisRequest } from "./indices";

export function geojsonDownload(request: AnalysisRequest) {
  const payload = {
    type: "FeatureCollection",
    metadata: {
      generatedAt: new Date().toISOString(),
      validationStatus: "indicative_not_validated",
      note: "AOI exportada. Métricas Sentinel dependem de provedor externo configurado."
    },
    features: [request.aoi]
  };

  return JSON.stringify(payload, null, 2);
}
