import {
  AnalysisRequest,
  Indicator,
  SpectralIndex,
  TimeSeriesPoint,
  buildUnavailableIndicators
} from "./indices";

const TOKEN_URL =
  process.env.SENTINELHUB_TOKEN_URL ??
  "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token";
const PROCESS_URL = process.env.SENTINELHUB_PROCESS_URL ?? "https://services.sentinel-hub.com/api/v1/process";
const STATISTICS_URL = process.env.SENTINELHUB_STATISTICS_URL ?? "https://services.sentinel-hub.com/api/v1/statistics";

const SCL_MASK_COMMENT =
  "Mascara SCL: remove no-data, saturado/defeituoso, pixel escuro, sombra, nuvem media/alta, cirrus e neve.";

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

type StatsBand = {
  stats?: {
    min?: number;
    max?: number;
    mean?: number;
    stDev?: number;
    sampleCount?: number;
    noDataCount?: number;
  };
};

type StatsInterval = {
  interval: {
    from: string;
    to: string;
  };
  outputs?: {
    indices?: {
      bands?: Partial<Record<Exclude<SpectralIndex, "dnbr">, StatsBand>>;
    };
  };
};

type StatsResponse = {
  data?: StatsInterval[];
};

export type TilePalette = {
  low: string;
  midLow: string;
  midHigh: string;
  high: string;
};

export function hasSentinelHubCredentials() {
  return Boolean(process.env.SENTINELHUB_CLIENT_ID && process.env.SENTINELHUB_CLIENT_SECRET);
}

export async function getSentinelHubToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.accessToken;
  }

  const clientId = process.env.SENTINELHUB_CLIENT_ID;
  const clientSecret = process.env.SENTINELHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Configure SENTINELHUB_CLIENT_ID e SENTINELHUB_CLIENT_SECRET em .env.local.");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Falha na autenticação Sentinel Hub: HTTP ${response.status}. ${message}`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };

  if (!data.access_token) {
    throw new Error("Sentinel Hub não retornou access_token.");
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 300) * 1000
  };

  return tokenCache.accessToken;
}

export function buildProcessTileUrl(
  index: SpectralIndex,
  request: Pick<AnalysisRequest, "dateFrom" | "dateTo" | "cloudCoverMax" | "compareFrom" | "compareTo">
) {
  const params = new URLSearchParams({
    dateFrom: request.dateFrom,
    dateTo: request.dateTo,
    cloudCoverMax: String(request.cloudCoverMax)
  });

  if (request.compareFrom) {
    params.set("compareFrom", request.compareFrom);
  }

  if (request.compareTo) {
    params.set("compareTo", request.compareTo);
  }

  return `/api/tiles/${index}/{z}/{x}/{y}?${params.toString()}`;
}

export async function fetchProcessTile({
  index,
  bbox,
  dateFrom,
  dateTo,
  cloudCoverMax,
  compareFrom,
  compareTo,
  palette
}: {
  index: SpectralIndex;
  bbox: [number, number, number, number];
  dateFrom: string;
  dateTo: string;
  cloudCoverMax: number;
  compareFrom?: string;
  compareTo?: string;
  palette?: TilePalette;
}) {
  const token = await getSentinelHubToken();
  const body =
    index === "dnbr"
      ? buildDnbrProcessRequest({ bbox, dateFrom, dateTo, cloudCoverMax, compareFrom, compareTo, palette })
      : buildSingleIndexProcessRequest({ index, bbox, dateFrom, dateTo, cloudCoverMax, palette });

  const response = await fetch(PROCESS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "image/png"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Sentinel Hub Process API retornou HTTP ${response.status}. ${message}`);
  }

  return response.arrayBuffer();
}

export async function fetchTrueColorTile({
  bbox,
  dateFrom,
  dateTo,
  cloudCoverMax
}: {
  bbox: [number, number, number, number];
  dateFrom: string;
  dateTo: string;
  cloudCoverMax: number;
}) {
  const token = await getSentinelHubToken();
  const response = await fetch(PROCESS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "image/png"
    },
    body: JSON.stringify({
      input: {
        bounds: {
          bbox,
          properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" }
        },
        data: [
          {
            type: "sentinel-2-l2a",
            dataFilter: {
              timeRange: {
                from: toIsoStart(dateFrom),
                to: toIsoEnd(dateTo)
              },
              maxCloudCoverage: cloudCoverMax,
              mosaickingOrder: "leastCC"
            }
          }
        ]
      },
      output: {
        width: 256,
        height: 256,
        responses: [{ identifier: "default", format: { type: "image/png" } }]
      },
      evalscript: buildTrueColorEvalscript()
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Sentinel Hub Process API RGB retornou HTTP ${response.status}. ${message}`);
  }

  return response.arrayBuffer();
}

export async function fetchTimeSeries(request: AnalysisRequest): Promise<TimeSeriesPoint[]> {
  const token = await getSentinelHubToken();
  const response = await fetch(STATISTICS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildStatisticsRequest(request))
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Sentinel Hub Statistical API retornou HTTP ${response.status}. ${message}`);
  }

  const stats = (await response.json()) as StatsResponse;
  const series = parseStatsResponse(stats);

  if (request.mode === "before_after" && request.compareFrom && request.compareTo) {
    return enrichDnbr(request, series);
  }

  return series;
}

export function buildIndicators(series: TimeSeriesPoint[]): Indicator[] {
  if (!series.length) {
    return buildUnavailableIndicators();
  }

  const latest = [...series].reverse().find((point) => hasAnyIndex(point));
  const avg = meanPoint(series);

  if (!latest) {
    return buildUnavailableIndicators();
  }

  return [
    {
      key: "water",
      label: "Água provável",
      value: formatClass(avg.mndwi !== undefined && avg.mndwi > 0.15 && (avg.ndvi ?? 1) < 0.25),
      confidence: classifyConfidence(avg.mndwi, 0.15, "high"),
      description: `MNDWI médio ${formatNumber(avg.mndwi)} e NDVI médio ${formatNumber(avg.ndvi)}. ${SCL_MASK_COMMENT}`
    },
    {
      key: "persistentVegetation",
      label: "Vegetação persistente",
      value: formatClass((avg.ndvi ?? -1) > 0.55 || (avg.ndre ?? -1) > 0.35),
      confidence: classifyConfidence(avg.ndvi, 0.55, "high"),
      description: `NDVI médio ${formatNumber(avg.ndvi)} e NDRE médio ${formatNumber(avg.ndre)} na série processada.`
    },
    {
      key: "exposedSoil",
      label: "Solo exposto",
      value: formatClass((avg.bsi ?? -1) > 0.15 && (avg.ndvi ?? 1) < 0.35),
      confidence: classifyConfidence(avg.bsi, 0.15, "medium"),
      description: `BSI médio ${formatNumber(avg.bsi)} com NDVI médio ${formatNumber(avg.ndvi)}. Não diferencia solo urbano sem base auxiliar.`
    },
    {
      key: "possibleBurn",
      label: "Possível queimada",
      value: formatClass((avg.dnbr ?? -1) > 0.25 || (latest.nbr ?? 1) < 0.1),
      confidence: avg.dnbr !== undefined ? classifyConfidence(avg.dnbr, 0.25, "medium") : "low",
      description: `NBR recente ${formatNumber(latest.nbr)} e dNBR ${formatNumber(avg.dnbr)} quando há comparação antes/depois.`
    },
    {
      key: "degradation",
      label: "Degradação",
      value: formatClass(hasNegativeTrend(series, "ndvi") && hasPositiveTrend(series, "bsi")),
      confidence: series.length >= 4 ? "medium" : "low",
      description: "Regra indicativa: queda de NDVI combinada com aumento de BSI na série temporal mascarada por SCL."
    },
    {
      key: "recentChange",
      label: "Mudança recente",
      value: formatClass(Math.abs((latest.ndvi ?? 0) - (series[0]?.ndvi ?? 0)) > 0.2),
      confidence: series.length >= 2 ? "medium" : "low",
      description: `Delta NDVI entre primeiro e último intervalo: ${formatNumber((latest.ndvi ?? 0) - (series[0]?.ndvi ?? 0))}.`
    }
  ];
}

function buildSingleIndexProcessRequest({
  index,
  bbox,
  dateFrom,
  dateTo,
  cloudCoverMax,
  palette
}: {
  index: SpectralIndex;
  bbox: [number, number, number, number];
  dateFrom: string;
  dateTo: string;
  cloudCoverMax: number;
  palette?: TilePalette;
}) {
  return {
    input: {
      bounds: {
        bbox,
        properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" }
      },
      data: [
        {
          type: "sentinel-2-l2a",
          dataFilter: {
            timeRange: {
              from: toIsoStart(dateFrom),
              to: toIsoEnd(dateTo)
            },
            maxCloudCoverage: cloudCoverMax,
            mosaickingOrder: "leastCC"
          }
        }
      ]
    },
    output: {
      width: 256,
      height: 256,
      responses: [{ identifier: "default", format: { type: "image/png" } }]
    },
    evalscript: buildIndexTileEvalscript(index, palette)
  };
}

function buildDnbrProcessRequest({
  bbox,
  dateFrom,
  dateTo,
  cloudCoverMax,
  compareFrom,
  compareTo,
  palette
}: {
  bbox: [number, number, number, number];
  dateFrom: string;
  dateTo: string;
  cloudCoverMax: number;
  compareFrom?: string;
  compareTo?: string;
  palette?: TilePalette;
}) {
  const beforeFrom = compareFrom || dateFrom;
  const beforeTo = compareFrom || dateFrom;
  const afterFrom = compareTo || dateTo;
  const afterTo = compareTo || dateTo;

  return {
    input: {
      bounds: {
        bbox,
        properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" }
      },
      data: [
        {
          id: "before",
          type: "sentinel-2-l2a",
          dataFilter: {
            timeRange: { from: toIsoStart(beforeFrom), to: toIsoEnd(beforeTo) },
            maxCloudCoverage: cloudCoverMax,
            mosaickingOrder: "leastCC"
          }
        },
        {
          id: "after",
          type: "sentinel-2-l2a",
          dataFilter: {
            timeRange: { from: toIsoStart(afterFrom), to: toIsoEnd(afterTo) },
            maxCloudCoverage: cloudCoverMax,
            mosaickingOrder: "leastCC"
          }
        }
      ]
    },
    output: {
      width: 256,
      height: 256,
      responses: [{ identifier: "default", format: { type: "image/png" } }]
    },
    evalscript: buildDnbrTileEvalscript(palette)
  };
}

function buildStatisticsRequest(request: AnalysisRequest) {
  const days = diffDays(request.dateFrom, request.dateTo);

  return {
    input: {
      bounds: {
        geometry: request.aoi.geometry,
        properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" }
      },
      data: [
        {
          type: "sentinel-2-l2a",
          dataFilter: {
            timeRange: {
              from: toIsoStart(request.dateFrom),
              to: toIsoEnd(request.dateTo)
            },
            maxCloudCoverage: request.cloudCoverMax,
            mosaickingOrder: "leastCC"
          }
        }
      ]
    },
    aggregation: {
      timeRange: {
        from: toIsoStart(request.dateFrom),
        to: toIsoEnd(request.dateTo)
      },
      aggregationInterval: {
        of: days > 120 ? "P1M" : "P10D"
      },
      evalscript: buildStatisticsEvalscript()
    },
    calculations: {
      indices: {
        statistics: {
          default: {
            percentiles: {
              k: [10, 50, 90]
            }
          }
        }
      }
    }
  };
}

function buildIndexTileEvalscript(index: SpectralIndex, palette?: TilePalette) {
  const expression = indexExpression(index);
  const ramp = colorRamp(index, palette);

  return `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B02", "B03", "B04", "B05", "B08", "B11", "B12", "SCL", "dataMask"] }],
    output: { bands: 4, sampleType: "UINT8" }
  };
}

function clear(sample) {
  return sample.dataMask === 1 && [0, 1, 2, 3, 8, 9, 10, 11].indexOf(sample.SCL) === -1;
}

function safeIndex(a, b) {
  var denominator = a + b;
  return denominator === 0 ? NaN : (a - b) / denominator;
}

function colorize(value) {
  if (!isFinite(value)) return [0, 0, 0, 0];
  ${ramp}
}

function evaluatePixel(sample) {
  if (!clear(sample)) return [0, 0, 0, 0];
  var value = ${expression};
  return colorize(value);
}`;
}

function buildDnbrTileEvalscript(palette?: TilePalette) {
  const colors = paletteToRgb(palette, [
    [230, 217, 165],
    [214, 132, 58],
    [191, 75, 47],
    [168, 32, 26]
  ]);

  return `//VERSION=3
function setup() {
  return {
    input: [
      { datasource: "before", bands: ["B08", "B12", "SCL", "dataMask"] },
      { datasource: "after", bands: ["B08", "B12", "SCL", "dataMask"] }
    ],
    output: { bands: 4, sampleType: "UINT8" }
  };
}

function clear(sample) {
  return sample.dataMask === 1 && [0, 1, 2, 3, 8, 9, 10, 11].indexOf(sample.SCL) === -1;
}

function safeIndex(a, b) {
  var denominator = a + b;
  return denominator === 0 ? NaN : (a - b) / denominator;
}

function colorize(value) {
  if (!isFinite(value)) return [0, 0, 0, 0];
  if (value < 0.1) return [${colors[0][0]}, ${colors[0][1]}, ${colors[0][2]}, 210];
  if (value < 0.27) return [${colors[1][0]}, ${colors[1][1]}, ${colors[1][2]}, 220];
  if (value < 0.44) return [${colors[2][0]}, ${colors[2][1]}, ${colors[2][2]}, 230];
  return [${colors[3][0]}, ${colors[3][1]}, ${colors[3][2]}, 240];
}

function evaluatePixel(samples) {
  var before = samples.before[0];
  var after = samples.after[0];
  if (!before || !after || !clear(before) || !clear(after)) return [0, 0, 0, 0];
  var nbrBefore = safeIndex(before.B08, before.B12);
  var nbrAfter = safeIndex(after.B08, after.B12);
  return colorize(nbrBefore - nbrAfter);
}`;
}

function buildStatisticsEvalscript() {
  return `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B02", "B03", "B04", "B05", "B08", "B11", "B12", "SCL", "dataMask"] }],
    output: [
      { id: "indices", bands: ["ndvi", "ndmi", "mndwi", "nbr", "bsi", "ndre"], sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}

function clear(sample) {
  return sample.dataMask === 1 && [0, 1, 2, 3, 8, 9, 10, 11].indexOf(sample.SCL) === -1;
}

function safeIndex(a, b) {
  var denominator = a + b;
  return denominator === 0 ? NaN : (a - b) / denominator;
}

function evaluatePixel(sample) {
  var valid = clear(sample);
  var ndvi = safeIndex(sample.B08, sample.B04);
  var ndmi = safeIndex(sample.B08, sample.B11);
  var mndwi = safeIndex(sample.B03, sample.B11);
  var nbr = safeIndex(sample.B08, sample.B12);
  var bsiDen = sample.B11 + sample.B04 + sample.B08 + sample.B02;
  var bsi = bsiDen === 0 ? NaN : ((sample.B11 + sample.B04) - (sample.B08 + sample.B02)) / bsiDen;
  var ndre = safeIndex(sample.B08, sample.B05);
  return {
    indices: [ndvi, ndmi, mndwi, nbr, bsi, ndre],
    dataMask: [valid ? 1 : 0]
  };
}`;
}

function buildTrueColorEvalscript() {
  return `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B02", "B03", "B04", "dataMask"] }],
    output: { bands: 4, sampleType: "UINT8" }
  };
}

function scale(value) {
  return Math.max(0, Math.min(255, value * 255 * 2.8));
}

function evaluatePixel(sample) {
  if (sample.dataMask !== 1) return [0, 0, 0, 0];
  return [scale(sample.B04), scale(sample.B03), scale(sample.B02), 255];
}`;
}

function indexExpression(index: SpectralIndex) {
  switch (index) {
    case "ndvi":
      return "safeIndex(sample.B08, sample.B04)";
    case "ndmi":
      return "safeIndex(sample.B08, sample.B11)";
    case "mndwi":
      return "safeIndex(sample.B03, sample.B11)";
    case "nbr":
      return "safeIndex(sample.B08, sample.B12)";
    case "bsi":
      return "((sample.B11 + sample.B04) - (sample.B08 + sample.B02)) / (sample.B11 + sample.B04 + sample.B08 + sample.B02)";
    case "ndre":
      return "safeIndex(sample.B08, sample.B05)";
    case "dnbr":
      return "0";
  }
}

function colorRamp(index: SpectralIndex, palette?: TilePalette) {
  const fallbackByIndex: Record<SpectralIndex, [[number, number, number], [number, number, number], [number, number, number], [number, number, number]]> = {
    ndvi: [
      [127, 59, 8],
      [241, 183, 91],
      [148, 198, 107],
      [29, 106, 74]
    ],
    ndmi: [
      [138, 95, 54],
      [215, 195, 106],
      [79, 165, 143],
      [29, 93, 131]
    ],
    mndwi: [
      [141, 126, 109],
      [201, 221, 214],
      [85, 166, 189],
      [23, 101, 130]
    ],
    nbr: [
      [79, 45, 31],
      [190, 106, 58],
      [180, 198, 106],
      [47, 112, 78]
    ],
    dnbr: [
      [230, 217, 165],
      [214, 132, 58],
      [191, 75, 47],
      [168, 32, 26]
    ],
    bsi: [
      [36, 91, 77],
      [183, 199, 122],
      [197, 141, 80],
      [125, 78, 47]
    ],
    ndre: [
      [127, 59, 8],
      [241, 183, 91],
      [148, 198, 107],
      [29, 106, 74]
    ]
  };
  const colors = paletteToRgb(palette, fallbackByIndex[index]);

  switch (index) {
    case "ndvi":
    case "ndre":
      return `
  if (value < 0.15) return [${colors[0][0]}, ${colors[0][1]}, ${colors[0][2]}, 205];
  if (value < 0.35) return [${colors[1][0]}, ${colors[1][1]}, ${colors[1][2]}, 215];
  if (value < 0.60) return [${colors[2][0]}, ${colors[2][1]}, ${colors[2][2]}, 225];
  return [${colors[3][0]}, ${colors[3][1]}, ${colors[3][2]}, 235];`;
    case "ndmi":
      return `
  if (value < -0.1) return [${colors[0][0]}, ${colors[0][1]}, ${colors[0][2]}, 205];
  if (value < 0.15) return [${colors[1][0]}, ${colors[1][1]}, ${colors[1][2]}, 215];
  if (value < 0.35) return [${colors[2][0]}, ${colors[2][1]}, ${colors[2][2]}, 225];
  return [${colors[3][0]}, ${colors[3][1]}, ${colors[3][2]}, 235];`;
    case "mndwi":
      return `
  if (value < 0) return [${colors[0][0]}, ${colors[0][1]}, ${colors[0][2]}, 180];
  if (value < 0.15) return [${colors[1][0]}, ${colors[1][1]}, ${colors[1][2]}, 205];
  if (value < 0.35) return [${colors[2][0]}, ${colors[2][1]}, ${colors[2][2]}, 225];
  return [${colors[3][0]}, ${colors[3][1]}, ${colors[3][2]}, 235];`;
    case "nbr":
      return `
  if (value < 0.1) return [${colors[0][0]}, ${colors[0][1]}, ${colors[0][2]}, 220];
  if (value < 0.27) return [${colors[1][0]}, ${colors[1][1]}, ${colors[1][2]}, 220];
  if (value < 0.55) return [${colors[2][0]}, ${colors[2][1]}, ${colors[2][2]}, 225];
  return [${colors[3][0]}, ${colors[3][1]}, ${colors[3][2]}, 235];`;
    case "bsi":
      return `
  if (value < -0.1) return [${colors[0][0]}, ${colors[0][1]}, ${colors[0][2]}, 200];
  if (value < 0.1) return [${colors[1][0]}, ${colors[1][1]}, ${colors[1][2]}, 215];
  if (value < 0.25) return [${colors[2][0]}, ${colors[2][1]}, ${colors[2][2]}, 225];
  return [${colors[3][0]}, ${colors[3][1]}, ${colors[3][2]}, 235];`;
    case "dnbr":
      return "";
  }
}

function paletteToRgb(
  palette: TilePalette | undefined,
  fallback: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]]
) {
  if (!palette) {
    return fallback;
  }

  return [palette.low, palette.midLow, palette.midHigh, palette.high].map((color, index) => {
    const parsed = hexToRgb(color);
    return parsed ?? fallback[index];
  });
}

function hexToRgb(color: string) {
  const match = color.match(/^#?([0-9a-f]{6})$/i);
  if (!match) {
    return undefined;
  }

  const value = match[1];
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  ] as [number, number, number];
}

function parseStatsResponse(stats: StatsResponse): TimeSeriesPoint[] {
  return (stats.data ?? [])
    .map((item) => {
      const bands = item.outputs?.indices?.bands ?? {};
      return {
        date: item.interval.from.slice(0, 10),
        ndvi: validMean(bands.ndvi),
        ndmi: validMean(bands.ndmi),
        mndwi: validMean(bands.mndwi),
        nbr: validMean(bands.nbr),
        bsi: validMean(bands.bsi),
        ndre: validMean(bands.ndre)
      };
    })
    .filter(hasAnyIndex);
}

async function enrichDnbr(request: AnalysisRequest, series: TimeSeriesPoint[]) {
  if (!request.compareFrom || !request.compareTo) {
    return series;
  }

  const before = await fetchSingleWindowMean({
    ...request,
    dateFrom: request.compareFrom,
    dateTo: request.compareFrom,
    mode: "custom"
  });
  const after = await fetchSingleWindowMean({
    ...request,
    dateFrom: request.compareTo,
    dateTo: request.compareTo,
    mode: "custom"
  });
  const dnbr = before.nbr !== undefined && after.nbr !== undefined ? before.nbr - after.nbr : undefined;

  return series.map((point) => ({
    ...point,
    dnbr
  }));
}

async function fetchSingleWindowMean(request: AnalysisRequest) {
  const token = await getSentinelHubToken();
  const response = await fetch(STATISTICS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...buildStatisticsRequest(request),
      aggregation: {
        ...buildStatisticsRequest(request).aggregation,
        aggregationInterval: { of: "P1D" }
      }
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Falha ao calcular dNBR: HTTP ${response.status}. ${message}`);
  }

  return meanPoint(parseStatsResponse((await response.json()) as StatsResponse));
}

function validMean(band?: StatsBand) {
  const mean = band?.stats?.mean;
  return typeof mean === "number" && Number.isFinite(mean) ? Number(mean.toFixed(4)) : undefined;
}

function hasAnyIndex(point: TimeSeriesPoint) {
  return ["ndvi", "ndmi", "mndwi", "nbr", "dnbr", "bsi", "ndre"].some(
    (key) => typeof point[key as SpectralIndex] === "number"
  );
}

function meanPoint(series: TimeSeriesPoint[]): TimeSeriesPoint {
  const result: TimeSeriesPoint = { date: "media" };
  const keys: SpectralIndex[] = ["ndvi", "ndmi", "mndwi", "nbr", "dnbr", "bsi", "ndre"];

  keys.forEach((key) => {
    const values = series
      .map((point) => point[key])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    if (values.length) {
      result[key] = Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
    }
  });

  return result;
}

function hasNegativeTrend(series: TimeSeriesPoint[], key: SpectralIndex) {
  const first = series[0]?.[key];
  const last = series[series.length - 1]?.[key];
  return typeof first === "number" && typeof last === "number" && last - first < -0.15;
}

function hasPositiveTrend(series: TimeSeriesPoint[], key: SpectralIndex) {
  const first = series[0]?.[key];
  const last = series[series.length - 1]?.[key];
  return typeof first === "number" && typeof last === "number" && last - first > 0.1;
}

function classifyConfidence(value: number | undefined, threshold: number, whenAbove: "medium" | "high") {
  if (value === undefined) {
    return "unavailable";
  }

  return value > threshold ? whenAbove : "low";
}

function formatClass(condition: boolean) {
  return condition ? "detectado" : "baixo";
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "sem dado" : value.toFixed(3);
}

function toIsoStart(date: string) {
  return `${date}T00:00:00Z`;
}

function toIsoEnd(date: string) {
  return `${date}T23:59:59Z`;
}

function diffDays(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}
