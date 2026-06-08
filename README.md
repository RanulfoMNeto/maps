# Sentinel Ambiental

MVP web para análise ambiental indicativa com Sentinel-2 L2A. A aplicação oferece mapa interativo, busca geográfica, desenho de área de interesse, filtros temporais, camadas por índice espectral, legenda, cards de indicadores, gráfico temporal e exportação da AOI em GeoJSON.

## Importante

O projeto não inventa métricas ambientais. Sem Sentinel Hub, Google Earth Engine ou outro provedor configurado, a aplicação informa `provider_unconfigured` e mantém mapas, séries e indicadores como indisponíveis.

Os mapas são indicativos e não substituem laudo, validação de campo, análise jurídica de CAR, APP, Reserva Legal, autorizações, embargos ou bases oficiais.

## Stack

- Next.js, React, TypeScript e Tailwind CSS
- Leaflet e Leaflet Draw para mapa, busca, zoom e desenho de polígono
- Recharts para série temporal
- API Routes do Next.js para análise, geocodificação, tiles calculados e exportação
- Adaptador Sentinel Hub Process API e Statistical API com Sentinel-2 L2A

## Índices suportados

- NDVI: `(B08 - B04) / (B08 + B04)`
- NDMI: `(B08 - B11) / (B08 + B11)`
- MNDWI: `(B03 - B11) / (B03 + B11)`
- NBR: `(B08 - B12) / (B08 + B12)`
- dNBR: `NBR antes - NBR depois`
- BSI: `((B11 + B04) - (B08 + B02)) / ((B11 + B04) + (B08 + B02))`
- NDRE: `(B08 - B05) / (B08 + B05)`

Para Sentinel-2 L2A, a máscara de nuvem/sombra deve usar SCL no provedor:

- remover SCL 0, 1, 2, 3, 8, 9, 10 e 11 conforme o caso de uso;
- manter vegetação, solo, água e pixels válidos;
- complementar com limite de `CLOUDY_PIXEL_PERCENTAGE` quando disponível.

## Configuração

```bash
cp .env.example .env.local
npm install
npm run dev
```

Acesse `http://localhost:3000`.

## Sentinel Hub

Crie um OAuth client no Sentinel Hub e informe:

```bash
SENTINELHUB_CLIENT_ID=...
SENTINELHUB_CLIENT_SECRET=...
```

Com isso, o app calcula tiles PNG reais por índice em `/api/tiles/[index]/[z]/[x]/[y]` e série temporal real por AOI em `/api/analyze`.

O backend usa Sentinel-2 L2A, `maxCloudCoverage`, mosaicking `leastCC` e máscara SCL nos evalscripts. A máscara remove no-data, pixels saturados/defeituosos, área escura, sombra de nuvem, nuvens média/alta, cirrus e neve.

## CAR estadual

ZIPs de imóvel individual são importados no navegador. Bases estaduais grandes, como `car/minas_gerais`, precisam ser preparadas antes de serem exibidas no mapa. O pipeline usa GDAL para converter os shapefiles para GeoPackage com índice espacial.

Pré-requisitos locais:

```bash
ogr2ogr --version
unzip -v
```

Conferir a estrutura sem processar os dados:

```bash
npm run car:ingest:check
```

Gerar a base local consultável pelo app:

```bash
npm run car:ingest
```

Durante a ingestão, o terminal mostra uma barra de progresso por shapefile. O processo grava `data/car-standard/ingest-state.json` após cada camada concluída; se for interrompido, a próxima execução pula camadas completas e recomeça apenas a camada que estava em andamento, evitando duplicidade parcial.

Camadas configuradas sem ZIP correspondente são puladas com aviso. Para deixar uma base pesada fora da ingestão, mova o ZIP para uma pasta que não esteja configurada no catálogo, por exemplo `car/minas_gerais/ignore/`.

Recriar do zero:

```bash
npm run car:ingest:reset
```

O app lê `data/car-standard/manifest.json` e `data/car-standard/*.gpkg`. Esses arquivos são artefatos locais e ficam fora do Git. A API `/api/car/standard/metadata` informa estados, municípios e camadas preparadas; `/api/car/standard/geojson` retorna apenas as feições do viewport atual, com filtro opcional de município.

## Arquitetura de evolução

Para um produto operacional, evolua os adaptadores em `app/lib/provider.ts` e `app/lib/sentinelHub.ts`:

- exportação GeoTIFF/PNG em área inteira via Sentinel Hub Async Process API ou Google Earth Engine;
- cache por hash de AOI, datas, índice e provedor;
- filas para exportações longas;
- autenticação e auditoria por organização;
- integração CAR/SICAR, MapBiomas, hidrografia, APP, Reserva Legal, embargos e dados de campo.

## Regras indicativas

- Água provável: MNDWI positivo e NDVI baixo.
- Vegetação persistente: NDVI/NDRE altos em múltiplas datas.
- Solo exposto: BSI elevado e NDVI baixo.
- Possível queimada: NBR baixo ou dNBR elevado.
- Degradação: queda recorrente de NDVI/NDMI e aumento de BSI.
- Mudança recente: diferença relevante entre composições antes/depois.

Essas regras precisam de calibração regional, validação de campo e cruzamento com bases oficiais antes de qualquer decisão ambiental ou fundiária.

## Exportações

No MVP, GeoJSON da AOI está implementado. GeoTIFF, PNG, CSV e PDF dependem de provedor configurado e rotinas adicionais de processamento/exportação assíncronas.
