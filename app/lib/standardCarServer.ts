import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  findStandardCarLayer,
  findStandardCarState,
  StandardCarCity,
  StandardCarMetadata,
  STANDARD_CAR_STATES
} from "./standardCarCatalog";

const execFileAsync = promisify(execFile);

type IngestManifest = {
  generatedAt?: string;
  states?: Record<string, { cities?: StandardCarCity[] }>;
};

type IngestState = {
  updatedAt?: string;
  states?: Record<string, { layers?: Record<string, { completedAt?: string }> }>;
};

type StandardCarQuery = {
  stateId: string;
  layerId: string;
  bbox: [number, number, number, number];
  municipality?: string;
  limit: number;
  simplify: number;
};

const MAX_GEOJSON_BYTES = 50 * 1024 * 1024;
const QUERY_TIMEOUT_MS = 45_000;

export function getStandardCarMetadata(): StandardCarMetadata {
  const manifest = readIngestManifest();
  const ingestState = readIngestState();
  const generatedAt = manifest.generatedAt ?? ingestState.updatedAt ?? new Date().toISOString();

  return {
    generatedAt,
    states: STANDARD_CAR_STATES.map((state) => {
      const prepared = state.layers.some((layer) => isLayerPrepared(ingestState, state.id, layer.id));
      const manifestState = manifest.states?.[state.id];
      return {
        ...state,
        prepared,
        cities: manifestState?.cities ?? [],
        layers: state.layers.map((layer) => ({
          ...layer,
          prepared: isLayerPrepared(ingestState, state.id, layer.id)
        }))
      };
    })
  };
}

export function isStatePrepared(stateId: string) {
  const state = findStandardCarState(stateId);
  return Boolean(state && existsSync(resolveProjectPath(state.databaseFile)));
}

export async function queryStandardCarGeoJson(query: StandardCarQuery) {
  const state = findStandardCarState(query.stateId);
  const layer = findStandardCarLayer(query.stateId, query.layerId);

  if (!state || !layer) {
    throw new StandardCarError(404, "Camada estadual do CAR não encontrada.");
  }

  const databasePath = resolveProjectPath(state.databaseFile);
  if (!existsSync(databasePath)) {
    throw new StandardCarError(
      503,
      `Base ${state.label} ainda não foi preparada. Execute npm run car:ingest antes de exibir esta camada.`
    );
  }

  if (!isLayerPrepared(readIngestState(), state.id, layer.id)) {
    throw new StandardCarError(503, `Camada ${layer.label} ainda não foi preparada. Continue npm run car:ingest.`);
  }

  const [west, south, east, north] = query.bbox;
  const args = [
    "-f",
    "GeoJSON",
    "-spat",
    String(west),
    String(south),
    String(east),
    String(north),
    "-limit",
    String(query.limit),
    "-lco",
    "RFC7946=YES"
  ];

  if (query.simplify > 0) {
    args.push("-simplify", String(query.simplify));
  }

  const sql = buildLayerSql(state.areaTableName, layer.tableName, query.municipality);
  if (sql) {
    args.push("-dialect", "SQLite", "-sql", sql, "/vsistdout/", databasePath);
  } else {
    args.push("/vsistdout/", databasePath, layer.tableName);
  }

  try {
    const { stdout } = await execFileAsync("ogr2ogr", args, {
      encoding: "utf8",
      maxBuffer: MAX_GEOJSON_BYTES,
      timeout: QUERY_TIMEOUT_MS
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar camada estadual.";
    throw new StandardCarError(500, `GDAL não conseguiu consultar a camada ${layer.label}. ${message}`);
  }
}

export class StandardCarError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function buildLayerSql(areaTableName: string, layerTableName: string, municipality?: string) {
  if (!municipality) {
    return "";
  }

  const city = escapeSqlLiteral(municipality);
  if (layerTableName === areaTableName) {
    return `SELECT * FROM "${layerTableName}" WHERE municipio = '${city}'`;
  }

  return [
    `SELECT l.* FROM "${layerTableName}" l`,
    `INNER JOIN "${areaTableName}" a ON l.cod_imovel = a.cod_imovel`,
    `WHERE a.municipio = '${city}'`
  ].join(" ");
}

function readIngestManifest(): IngestManifest {
  const manifestPath = resolveProjectPath("data/car-standard/manifest.json");
  if (!existsSync(manifestPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as IngestManifest;
  } catch {
    return {};
  }
}

function readIngestState(): IngestState {
  const statePath = resolveProjectPath("data/car-standard/ingest-state.json");
  if (!existsSync(statePath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as IngestState;
  } catch {
    return {};
  }
}

function isLayerPrepared(ingestState: IngestState, stateId: string, layerId: string) {
  return Boolean(ingestState.states?.[stateId]?.layers?.[layerId]?.completedAt);
}

function resolveProjectPath(relativePath: string) {
  return path.join(process.cwd(), relativePath);
}

function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''");
}
