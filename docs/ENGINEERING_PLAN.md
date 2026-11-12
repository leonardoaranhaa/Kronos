# KRONOS — Engineering Plan

**Status:** Offline CI and the research build are the required gate. A later branch adds research signals, a walk-forward backtest and local paper simulation on top of this read-only pipeline.  
**Working branch:** `engineering/p1-data-integrity` (based on `engineering/foundation-audit`)  
**Scope:** Read-only market data, model inference, historical research, validation and observability. Paper fills are simulated. No order submission or real-money execution.

The measured backtest, when present, is `reports/backtest-latest.md`. Those numbers are an observation for one snapshot, one stride and one fixed rule set. They are not a target and they are not a claim about future trading.

## 1. Source-of-truth integrations

### Official Kronos model
- Repository: https://github.com/shiyu-coder/Kronos
- Pinned upstream commit: `67b630e67f6a18c9e9be918d9b4337c960db1e9a`
- Upstream branch: `master`
- Model artifact: `NeoQuasar/Kronos-small`
- Tokenizer artifact: `NeoQuasar/Kronos-Tokenizer-base`
- Model context limit: 512; this project defaults to 400 candles.
- The official predictor accepts OHLCV, timestamps and optional `amount`; Binance quote-asset volume is mapped to that field.

### Binance public market data
- REST base: `https://data-api.binance.vision`
- Historical endpoint: `GET /api/v3/klines`
- WebSocket base: `wss://data-stream.binance.vision/ws`
- The stream accepts only finalized klines (`k.x === true`).
- No API key or secret is used by the read-only data pipeline.

## 2. Engineering principles

1. Official upstream code and compatible pretrained weights are the source of truth for model inference.
2. Historical data is timestamped, validated, snapshotted and hashed.
3. No random fallback may be presented as a Kronos prediction.
4. Synthetic replay is explicitly labeled and never confused with Binance data.
5. Model forecasts and observed outcomes remain separate.
6. Experiments use chronological splits and prevent look-ahead leakage.
7. Order execution remains disconnected and outside the scope of these milestones.

## 3. Confirmed baseline findings

- The original Python worker generated random-walk forecasts instead of loading Kronos.
- The original market feed had no Binance connection.
- VPIN and OFI were randomized in the original server and are no longer emitted as market facts.
- The original Monte Carlo routine used synthetic assumptions and is not a historical backtest.
- The original order execution module remains in the repository but is not imported or instantiated by the research server.
- Credential-like values were removed from `.env.example`; the public-data pipeline requires no exchange credentials. Inspect history and revoke any values that were ever valid.

## 4. Delivery phases

### P0 — Repository and security baseline
- [x] Create isolated engineering branch.
- [x] Replace credential-like values in environment examples.
- [x] Document baseline and research-only gates.

### P1 — Data ingestion and integrity

**Current correction branch:** `engineering/p1-data-integrity`. Changes are proposed for review; no milestone is marked complete until tests and runtime evidence are produced.
- [x] Canonical candle schema with quote-asset volume.
- [x] OHLCV and interval-boundary validation.
- [x] Duplicate, gap and mixed-series audit.
- [x] Binance WebSocket adapter; only finalized klines are emitted.
- [x] Historical REST importer with pagination, rate-limit retries and raw/normalized snapshots.
- [x] SHA-256 manifest for each normalized snapshot.
- [x] Raw and normalized snapshot SHA-256 hashes.
- [x] Empty datasets and malformed Binance rows fail closed.
- [x] Deterministic chronological replay from validated historical snapshots; random replay removed.
- [x] Startup loading of a validated historical snapshot.
- [x] Offline unit tests for Binance row normalization, pagination cursor safety and snapshot hashes (CI passed; 6/6).
- [ ] Runtime test against the live public stream and a historical import.

### P2 — Official Kronos integration
- [x] Pin official source revision.
- [x] Configure official pretrained model and tokenizer IDs.
- [x] Replace random prediction fallback with explicit worker error state.
- [x] Use official `KronosPredictor` API and preserve model provenance in responses.
- [ ] Install dependencies, download model artifacts and verify inference against upstream examples.

### P3 — Training and fine-tuning
- [ ] Establish whether fine-tuning is justified; pretrained inference is the baseline.
- [ ] Define instrument/timeframe datasets and minimum data requirements.
- [ ] Use chronological train/validation/test partitions and document leakage policy.
- [ ] Record data snapshot, code revision, configuration, seeds and artifact hashes.

### P4 — Forecast evaluation
- [ ] Evaluate MAE, RMSE and scale-aware metrics by horizon and regime.
- [ ] Compare with persistence and statistical baselines.
- [ ] Evaluate only on future/out-of-sample periods; do not optimize on the test set.
- [ ] Keep forecast evaluation separate from hypothetical strategy simulation.

### P5 — Observability
- [x] Expose feed and model status through health endpoint.
- [x] Return HTTP 503 / `degraded` when feed or official model is not ready.
- [x] Emit data-quality warnings for invalid, duplicate or out-of-order candles.
- [ ] Persist forecasts and later observed outcomes.
- [ ] Add structured logs, graceful recovery and latency metrics.

### P6 — Release hardening
- [x] Add offline GitHub Actions CI for candle, feed, importer, replay, health, build and syntax checks (passed on commit `9baf3a5`; PR run #16).
- [ ] Validate clean install, historical import, WebSocket reconnect and model startup.
- [ ] Review dependency and secret-management posture.
- [ ] Keep live order execution disabled.

## 5. Definition of done

A milestone is complete only with committed code, tests, reproducible evidence and documented limitations. A successful WebSocket connection or a model output alone does not demonstrate forecast quality.
