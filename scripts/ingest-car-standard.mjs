#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = process.cwd();
const OUTPUT_DIR = path.join(PROJECT_ROOT, "data/car-standard");
const CHECKPOINT_FILE = path.join(OUTPUT_DIR, "ingest-state.json");
const LOCK_FILE = path.join(OUTPUT_DIR, "ingest.lock.json");
const RESET = process.argv.includes("--reset");
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const BAR_WIDTH = 28;

const STATES = [
  {
    id: "minas_gerais",
    label: "Minas Gerais",
    uf: "MG",
    sourceDir: "car/minas_gerais",
    databaseFile: "data/car-standard/minas_gerais.gpkg",
    areaTableName: "car_mg_area_imovel",
    layers: [
      { id: "area_imovel", tableName: "car_mg_area_imovel", zipFile: "AREA_IMOVEL.zip" },
      { id: "apps", tableName: "car_mg_apps", zipFile: "APPS.zip", alternateZipFiles: ["outros/APPS.zip"] },
      { id: "reserva_legal", tableName: "car_mg_reserva_legal", zipFile: "RESERVA_LEGAL.zip" },
      { id: "vegetacao_nativa", tableName: "car_mg_vegetacao_nativa", zipFile: "VEGETACAO_NATIVA.zip" },
      {
        id: "hidrografia",
        tableName: "car_mg_hidrografia",
        zipFile: "HIDROGRAFIA.zip",
        alternateZipFiles: ["outros/HIDROGRAFIA.zip"]
      },
      { id: "area_consolidada", tableName: "car_mg_area_consolidada", zipFile: "AREA_CONSOLIDADA.zip" },
      { id: "uso_restrito", tableName: "car_mg_uso_restrito", zipFile: "USO_RESTRITO.zip" },
      {
        id: "servidao_administrativa",
        tableName: "car_mg_servidao_administrativa",
        zipFile: "SERVIDAO_ADMINISTRATIVA.zip"
      },
      { id: "area_pousio", tableName: "car_mg_area_pousio", zipFile: "AREA_POUSIO.zip" }
    ]
  }
];

await main();

async function main() {
  await assertCommand("ogr2ogr", ["--version"]);
  await assertCommand("ogrinfo", ["--version"]);
  await assertCommand("unzip", ["-v"]);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  if (DRY_RUN) {
    console.log("Modo conferencia: nenhum GeoPackage sera criado ou alterado.");
  }

  if (!DRY_RUN) {
    await acquireIngestLock();
  }

  try {
    const checkpoint = RESET || FORCE ? createEmptyCheckpoint() : await readCheckpoint();
    const manifest = {
      generatedAt: new Date().toISOString(),
      states: {}
    };

    for (const state of STATES) {
      const databasePath = path.join(PROJECT_ROOT, state.databaseFile);
      if (RESET && existsSync(databasePath)) {
        await fs.rm(databasePath, { force: true });
        await fs.rm(`${databasePath}-shm`, { force: true });
        await fs.rm(`${databasePath}-wal`, { force: true });
      }

      console.log(`\n== ${state.label} ==`);
      for (const layer of state.layers) {
        await ingestLayer(state, layer, databasePath, checkpoint);
      }

      const cities = DRY_RUN ? [] : await readCities(databasePath, state.areaTableName, state.uf);
      manifest.states[state.id] = { cities };
      if (!DRY_RUN) {
        console.log(`Municípios indexados: ${cities.length}`);
      }
    }

    if (!DRY_RUN) {
      await fs.writeFile(path.join(OUTPUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      console.log("\nManifesto gravado em data/car-standard/manifest.json");
    }
  } finally {
    if (!DRY_RUN) {
      await releaseIngestLock();
    }
  }
}

async function ingestLayer(state, layer, databasePath, checkpoint) {
  const zipPath = resolveLayerZipPath(state, layer);
  if (!zipPath) {
    const candidates = layerZipCandidates(state, layer).map((candidate) => path.relative(PROJECT_ROOT, candidate));
    console.warn(`Pulando ${layer.id}: ZIP ausente. Procurado em: ${candidates.join(", ")}`);
    return;
  }

  const shapefiles = await listShapefiles(zipPath);
  const sourceSignature = await getSourceSignature(zipPath, shapefiles);
  if (!shapefiles.length) {
    throw new Error(`Nenhum .shp encontrado em ${path.relative(PROJECT_ROOT, zipPath)}`);
  }

  if (!DRY_RUN && !FORCE && isLayerComplete(checkpoint, state.id, layer.id, sourceSignature) && existsSync(databasePath)) {
    console.log(`Pulando ${layer.id}: ja processado.`);
    return;
  }

  if (!DRY_RUN && !FORCE && await adoptExistingLayerIfComplete(state, layer, databasePath, zipPath, shapefiles, sourceSignature, checkpoint)) {
    return;
  }

  console.log(`Importando ${layer.id}: ${shapefiles.length} shapefile(s)`);
  if (DRY_RUN) {
    shapefiles.forEach((name) => console.log(`  ${name}`));
    return;
  }

  for (const [index, shpName] of shapefiles.entries()) {
    const source = `/vsizip/${zipPath}/${shpName}`;
    const isFirstSegment = index === 0;
    const args = [
      "-f",
      "GPKG",
      databasePath,
      source,
      "-nln",
      layer.tableName,
      "-nlt",
      "PROMOTE_TO_MULTI",
      "-dim",
      "XY",
      "-t_srs",
      "EPSG:4326",
      "-lco",
      "SPATIAL_INDEX=NO",
      "-skipfailures"
    ];

    if (existsSync(databasePath)) {
      args.push("-update");
    }

    if (isFirstSegment) {
      args.push("-overwrite");
    } else {
      args.push("-append");
    }

    args.push("-progress");

    await runWithProgress("ogr2ogr", args, `${layer.id} ${index + 1}/${shapefiles.length}: ${shpName}`);
  }

  await createSpatialIndex(databasePath, layer);

  markLayerComplete(checkpoint, state.id, layer.id, sourceSignature);
  await writeCheckpoint(checkpoint);
}

async function createSpatialIndex(databasePath, layer) {
  await runWithProgress(
    "ogrinfo",
    [
      databasePath,
      "-sql",
      `SELECT gpkgAddSpatialIndex('${escapeSqlLiteral(layer.tableName)}', 'geom')`
    ],
    `indice espacial ${layer.id}`
  );
}

async function listShapefiles(zipPath) {
  const { stdout } = await run("unzip", ["-Z1", zipPath]);
  return stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.toLowerCase().endsWith(".shp"))
    .sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));
}

function resolveLayerZipPath(state, layer) {
  return layerZipCandidates(state, layer).find((candidate) => existsSync(candidate)) ?? null;
}

function layerZipCandidates(state, layer) {
  const names = [layer.zipFile, ...(layer.alternateZipFiles ?? []), path.join("outros", path.basename(layer.zipFile))];
  return [...new Set(names)].map((name) => path.join(PROJECT_ROOT, state.sourceDir, name));
}

async function readCities(databasePath, areaTableName, uf) {
  const sql = `SELECT DISTINCT municipio FROM "${areaTableName}" WHERE municipio IS NOT NULL ORDER BY municipio`;
  const { stdout } = await run("ogr2ogr", [
    "-f",
    "CSV",
    "/vsistdout/",
    databasePath,
    "-dialect",
    "SQLite",
    "-sql",
    sql
  ]);

  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter(Boolean)
    .map((name) => ({ name, uf }));
}

async function adoptExistingLayerIfComplete(state, layer, databasePath, zipPath, shapefiles, sourceSignature, checkpoint) {
  if (!existsSync(databasePath)) {
    return false;
  }

  const [expectedCount, actualCount] = await Promise.all([
    countSourceFeatures(zipPath, shapefiles),
    countDatabaseLayerFeatures(databasePath, layer.tableName)
  ]);

  if (expectedCount === null || actualCount === null || expectedCount !== actualCount) {
    return false;
  }

  markLayerComplete(checkpoint, state.id, layer.id, sourceSignature);
  await writeCheckpoint(checkpoint);
  console.log(`Pulando ${layer.id}: tabela existente validada (${actualCount.toLocaleString("pt-BR")} feicoes).`);
  return true;
}

async function countSourceFeatures(zipPath, shapefiles) {
  let total = 0;
  for (const shpName of shapefiles) {
    const source = `/vsizip/${zipPath}/${shpName}`;
    const count = await countFeatures("ogrinfo", ["-ro", "-so", "-al", source]);
    if (count === null) {
      return null;
    }
    total += count;
  }
  return total;
}

async function countDatabaseLayerFeatures(databasePath, tableName) {
  return await countFeatures("ogrinfo", ["-ro", "-so", databasePath, tableName]);
}

async function countFeatures(command, args) {
  try {
    const { stdout } = await run(command, args, { timeout: 120_000, maxBuffer: 1024 * 1024 * 4 });
    const match = stdout.match(/Feature Count:\s*(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function createEmptyCheckpoint() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    states: {}
  };
}

async function acquireIngestLock() {
  const existing = await readIngestLock();
  if (existing && isPidRunning(existing.pid)) {
    throw new Error(
      `Outra ingestao parece estar em execucao (pid ${existing.pid}, iniciada em ${existing.startedAt}). Aguarde terminar ou finalize esse processo antes de iniciar outra.`
    );
  }

  await fs.writeFile(
    LOCK_FILE,
    `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}

async function releaseIngestLock() {
  const existing = await readIngestLock();
  if (!existing || existing.pid === process.pid) {
    await fs.rm(LOCK_FILE, { force: true });
  }
}

async function readIngestLock() {
  if (!existsSync(LOCK_FILE)) {
    return null;
  }

  try {
    return JSON.parse(await fs.readFile(LOCK_FILE, "utf8"));
  } catch {
    return null;
  }
}

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readCheckpoint() {
  if (!existsSync(CHECKPOINT_FILE)) {
    return createEmptyCheckpoint();
  }

  try {
    return JSON.parse(await fs.readFile(CHECKPOINT_FILE, "utf8"));
  } catch {
    return createEmptyCheckpoint();
  }
}

async function writeCheckpoint(checkpoint) {
  checkpoint.updatedAt = new Date().toISOString();
  await fs.writeFile(CHECKPOINT_FILE, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

async function getSourceSignature(zipPath, shapefiles) {
  const stat = await fs.stat(zipPath);
  return {
    zipFile: path.relative(PROJECT_ROOT, zipPath),
    size: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
    shapefiles
  };
}

function isLayerComplete(checkpoint, stateId, layerId, sourceSignature) {
  const layerState = checkpoint.states?.[stateId]?.layers?.[layerId];
  return Boolean(layerState?.completedAt && sameSignature(layerState.sourceSignature, sourceSignature));
}

function markLayerComplete(checkpoint, stateId, layerId, sourceSignature) {
  checkpoint.states[stateId] ??= { layers: {} };
  checkpoint.states[stateId].layers ??= {};
  checkpoint.states[stateId].layers[layerId] = {
    completedAt: new Date().toISOString(),
    sourceSignature
  };
}

function sameSignature(left, right) {
  return (
    left?.zipFile === right.zipFile &&
    left?.size === right.size &&
    left?.mtimeMs === right.mtimeMs &&
    JSON.stringify(left?.shapefiles ?? []) === JSON.stringify(right.shapefiles)
  );
}

async function assertCommand(command, args) {
  try {
    await run(command, args, { timeout: 10_000 });
  } catch {
    throw new Error(`Comando obrigatório não encontrado ou indisponível: ${command}`);
  }
}

async function runWithProgress(command, args, label) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const renderer = createProgressRenderer(label);
    const output = [];
    let progressBuffer = "";

    renderer.update(0);
    const heartbeat = setInterval(() => renderer.heartbeat(), 30_000);

    const handleData = (chunk) => {
      const text = chunk.toString();
      output.push(text);
      progressBuffer = `${progressBuffer}${text}`.slice(-1200);
      const progressMatches = progressBuffer.matchAll(/(\d{1,3})(?=\.\.\.)|(\d{1,3})(?=\s*-\s*done)/g);
      for (const match of progressMatches) {
        renderer.update(Number(match[1] ?? match[2]));
      }
    };

    child.stdout.on("data", handleData);
    child.stderr.on("data", handleData);
    child.on("error", (error) => {
      clearInterval(heartbeat);
      renderer.finish(false);
      reject(error);
    });
    child.on("close", (code) => {
      clearInterval(heartbeat);
      renderer.finish(code === 0);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} falhou com codigo ${code}.\n${output.join("").slice(-4000)}`));
    });
  });
}

function createProgressRenderer(label) {
  let lastPrintedBucket = -1;
  let lastPercent = 0;
  let lastHeartbeatMinute = -1;
  const startedAt = Date.now();

  return {
    update(percent, force = false) {
      const normalized = clampProgress(percent);
      lastPercent = normalized;
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${progressLine(label, normalized, startedAt)}`);
        return;
      }

      const bucket = Math.floor(normalized / 10);
      if (force || bucket !== lastPrintedBucket || normalized === 100) {
        lastPrintedBucket = bucket;
        console.log(progressLine(label, normalized, startedAt));
      }
    },
    heartbeat() {
      if (process.stdout.isTTY) {
        this.update(lastPercent, true);
        return;
      }

      const minute = Math.floor((Date.now() - startedAt) / 60_000);
      if (minute !== lastHeartbeatMinute) {
        lastHeartbeatMinute = minute;
        this.update(lastPercent, true);
      }
    },
    finish(success) {
      if (success) {
        this.update(100);
      }
      if (process.stdout.isTTY) {
        process.stdout.write(`${success ? "" : `\r${progressLine(label, lastPercent, startedAt)}`}\n`);
      }
    }
  };
}

function progressLine(label, percent, startedAt) {
  const filled = Math.round((percent / 100) * BAR_WIDTH);
  const bar = `${"#".repeat(filled)}${"-".repeat(BAR_WIDTH - filled)}`;
  return `  ${label} [${bar}] ${String(percent).padStart(3)}% decorrido ${formatElapsed(Date.now() - startedAt)}`;
}

function formatElapsed(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h${String(remainingMinutes).padStart(2, "0")}m`;
  }

  return `${minutes}m${String(remainingSeconds).padStart(2, "0")}s`;
}

function escapeSqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function clampProgress(percent) {
  if (!Number.isFinite(percent)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(percent)));
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: options.maxBuffer ?? 1024 * 1024 * 10,
      timeout: options.timeout ?? 120_000
    });
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${command} falhou. ${message}${stderr ? `\n${stderr}` : ""}`);
  }
}
