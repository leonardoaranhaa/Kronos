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
3. Run `bash scripts/setup-kronos.sh`. This creates `.venv` with `python3` (it does not call `python` or install into the system interpreter), checks out the pinned official Kronos source, installs a CPU torch wheel by default, and installs `pandas==2.2.3` because upstream `pandas==2.2.2` has no Python 3.13 wheel. On Debian/Ubuntu, `sudo apt install python3-venv` is required if `python3 -m venv` is missing. The script writes `KRONOS_PYTHON_PATH` and `KRONOS_DEVICE=cpu` into `.env`. Pretrained weights download from Hugging Face when the worker starts for the first time. Set `KRONOS_TORCH=default` only if you intentionally want a non-CPU torch wheel.
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

One offline command runs the tests, the TypeScript/Vite build, the Python syntax check and the shell syntax check:

```bash
npm run check
```

`npm run backtest` is separate. It needs the virtualenv, the pretrained weights and a validated snapshot, and it is not part of CI.

The `Research pipeline validation` GitHub Actions workflow runs these offline checks on the P1 branch and its pull request. A green workflow is required before treating the code as validated. These checks do not connect to Binance, download model weights, perform inference or submit orders.

## Data boundaries

The historical importer writes raw response pages, normalized JSONL candles and a SHA-256 manifest. The WebSocket adapter accepts finalized klines only. Replay mode consumes only a validated historical Binance snapshot from `HISTORICAL_DATA_PATH`, emits candles in timestamp order, and completes after the snapshot is exhausted. Random synthetic replay is disabled. Replay candles are labeled `replay` and are blocked from official model inference. No API key is required for public market data.

## Health endpoint

`GET /api/health` returns HTTP 200 with `status: ok` only when the configured feed is healthy and the official model worker is ready. It returns HTTP 503 with `status: degraded` while either component is starting, reconnecting or in an error state. A completed historical replay is considered a healthy feed state; this indicates that the finite replay completed, not that a live stream is running.

`historyCount` is the number of candles accepted since startup, including candles already dropped from the in-memory window. `retainedHistoryCount` is the window actually kept, capped at 600. `latestOpenTime` is the newest accepted open time, so a full window does not look frozen.
