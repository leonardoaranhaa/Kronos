# KRONOS — Binance data and official model setup

This branch configures a **read-only research pipeline**. It does not use account credentials or submit orders.

## Requirements

- Node.js 20 or newer
- Python 3.10 or newer
- Git
- Enough disk space for the Python dependencies and pretrained model files

## First setup

1. Copy `.env.example` to `.env`.
2. Install the Node dependencies with `npm install`.
3. Run `bash scripts/setup-kronos.sh`. This checks out the pinned official Kronos source and installs its Python requirements. The pretrained weights are downloaded from Hugging Face when the worker starts for the first time.
4. Run `npm run import:binance`. By default, this imports up to the most recent 1,000 completed candles for the configured symbol and interval.
5. Inspect the generated manifest under `data/manifests/`. Do not load a snapshot whose quality audit reports gaps, duplicates or invalid rows.
6. Copy the manifest's `normalizedPath` into `HISTORICAL_DATA_PATH` in `.env`.
7. Start the research server with `npm run dev:server`.

## Defaults

- Symbol: `BTCUSDT`
- Interval: `5m`
- Model: `NeoQuasar/Kronos-small`
- Tokenizer: `NeoQuasar/Kronos-Tokenizer-base`
- Model context: 400 candles (the upstream limit for Kronos-small is 512)

Change `SYMBOL` and `TIMEFRAME` in `.env` before importing a different series. Optional `START_TIME` and `END_TIME` values are Unix milliseconds.

## Checks

- `npm run test:candles`
- `npm run test:binance`
- `npm run test:replay`
- `npm run build`

These checks are provided but must be run in the developer's environment. No build, live stream, model download or inference result is claimed by this document.

## Data boundaries

The historical importer writes raw response pages, normalized JSONL candles and a SHA-256 manifest. The WebSocket adapter accepts finalized klines only. Replay mode consumes only a validated historical Binance snapshot from `HISTORICAL_DATA_PATH`, emits candles in timestamp order, and completes after the snapshot is exhausted. Random synthetic replay is disabled. Replay candles are labeled `replay` and are blocked from official model inference. No API key is required for public market data.
