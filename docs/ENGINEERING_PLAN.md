# KRONOS — Engineering Plan

**Status:** Foundation audit in progress  
**Baseline:** `main` — version declared in package metadata: 1.3.0  
**Working branch:** `engineering/foundation-audit`  
**Scope:** Research, data integrity, model integration, validation and observability. Live financial execution remains disabled throughout this plan.

## 1. Engineering principles

1. The official `shiyu-coder/Kronos` implementation, its tokenizer and compatible pretrained weights are the source of truth for model integration.
2. Historical market data must be reproducible, timestamped, validated and versioned.
3. No random fallback may be presented as a model prediction.
4. No synthetic VPIN, OFI, PnL, win rate or confidence may be presented as observed market evidence.
5. Model predictions, strategy hypotheses and measured outcomes must be stored as separate records.
6. All experiments must use chronological train/validation/test splits and prevent look-ahead leakage.
7. No production API credentials, live order routing or real-money execution are permitted in the research milestones.

## 2. Baseline findings confirmed from the current repository

- `server/kronos_worker.py` currently estimates future closes using random samples derived from recent returns; it does not load the official Kronos model or tokenizer.
- `server/kronos-bridge.ts` sends up to 50 candles to the Python worker, but does not implement request correlation, bounded buffering, readiness gating or robust process lifecycle handling.
- `server/index.ts` generates VPIN and OFI with random values. Its market event path therefore cannot be treated as genuine order-flow analytics.
- `server/market-feed.ts` currently implements a synthetic replay feed. The selected `binance` mode has no Binance connection in this file.
- `server/indicators.ts` computes indicators but also embeds heuristic confidence values and position-sizing logic. These values are not calibrated probabilities.
- `server/monte_carlo.ts` uses synthetic prices and hard-coded/random outcome assumptions, including a 96.5% win probability and fixed gains/losses. It is not a historical backtest and must not be used as evidence of performance.
- `server/order_execution.ts` contains signed order-submission code and reports `EXECUTED` after the entry response even if the protective OCO request was unsuccessful. This path must remain disconnected until independently reviewed and tested.
- `.env.example` contained values resembling API credentials. Treat them as compromised if they were ever valid; rotate/revoke them and inspect repository history. This branch replaces them with placeholders.

## 3. Target architecture

```
Historical / Replay Data
        |
        v
Ingestion -> Validation -> Canonical Candle Store
        |                         |
        v                         v
Live/Replay Feed             Dataset Builder
        |                         |
        v                         v
Feature & Quality Checks    Kronos Training / Fine-tuning
        |                         |
        +------------+------------+
                     v
             Versioned Inference
                     |
                     v
           Prediction Evaluation
                     |
          +----------+----------+
          |                     |
          v                     v
    Research API           Observability
          |                     |
          +----------+----------+
                     v
              Dashboard / Reports
```

The model service must be isolated from strategy evaluation. The dashboard must label synthetic replay, historical replay and live market data distinctly.

## 4. Delivery phases

### P0 — Repository and security baseline
- [x] Create an isolated engineering branch.
- [x] Replace credential-like values in `.env.example` with placeholders.
- [x] Record the confirmed baseline findings and engineering gates.
- [ ] Review repository history for credential exposure and rotate any affected keys.
- [ ] Add CI checks for secret scanning, formatting, type checking and tests.

**Exit criteria:** no credentials in tracked examples; baseline and known limitations documented.

### P1 — Data ingestion and historical candle integrity
- [ ] Specify canonical candle schema: venue, symbol, interval, open time, close time, OHLCV, source and ingestion timestamp.
- [ ] Add validation for invalid OHLC relationships, non-positive prices, negative volume, duplicate timestamps and missing intervals.
- [ ] Define candle finalization semantics; do not treat every update to an open candle as a new completed candle.
- [ ] Implement historical import with pagination, rate-limit handling, resumability and provenance.
- [ ] Persist immutable raw data and normalized datasets separately.
- [ ] Add deterministic replay from stored data.

**Exit criteria:** a dataset can be rebuilt and audited; quality report identifies gaps, duplicates and rejected rows.

### P2 — Official Kronos integration
- [ ] Pin the upstream Kronos source revision and document license/model provenance.
- [ ] Select a compatible pretrained model and tokenizer based on hardware and sequence requirements.
- [ ] Implement a Python adapter around the official inference API; do not reimplement model internals speculatively.
- [ ] Remove random prediction fallback. If the model is unavailable, return an explicit unavailable/error state.
- [ ] Add input schema validation, normalization parity, model version and inference metadata.
- [ ] Test deterministic behavior where supported and compare adapter output with upstream examples.

**Exit criteria:** reproducible inference using the official model and tokenizer, with no synthetic fallback represented as model output.

### P3 — Training and fine-tuning experiments
- [ ] Establish whether fine-tuning is justified; begin with pretrained inference as the baseline.
- [ ] Define instrument/timeframe-specific datasets and minimum data requirements.
- [ ] Use chronological train/validation/test partitions and a documented leakage policy.
- [ ] Record configuration, random seeds, data snapshot, code revision and model artifact hashes.
- [ ] Compare pretrained inference against fine-tuned variants and simple baselines.
- [ ] Track compute, memory, training duration and artifact lineage.

**Exit criteria:** experiment is reproducible and demonstrates out-of-sample results against explicit baselines.

### P4 — Evaluation and research metrics
- [ ] Evaluate forecast errors by horizon and market regime (MAE, RMSE and scale-aware metrics).
- [ ] Compare against naive persistence and simple statistical baselines.
- [ ] Report uncertainty/calibration only when methodologically supported.
- [ ] Keep forecast evaluation separate from any hypothetical strategy simulation.
- [ ] If strategy research is later approved, account for fees, spread, slippage, funding and execution assumptions; report drawdown and risk-adjusted metrics without optimizing on the test set.

**Exit criteria:** complete evaluation report with limitations and no unsupported performance claims.

### P5 — Observability and reliability
- [ ] Expose feed mode, data freshness, candle completeness and ingestion lag.
- [ ] Expose model readiness, model version, inference latency and error rate.
- [ ] Persist prediction records and later observed outcomes for evaluation.
- [ ] Add structured logs, health checks, graceful shutdown and bounded queues.
- [ ] Label synthetic/replay/live sources clearly in the dashboard.

**Exit criteria:** operators can distinguish stale data, unavailable model, synthetic replay and genuine market observations.

### P6 — Release hardening
- [ ] Add unit, integration, contract and regression tests.
- [ ] Validate clean installation and production build in CI.
- [ ] Review dependency, container and secret-management posture.
- [ ] Document setup, dataset refresh, model acquisition, reproducibility and recovery.
- [ ] Keep all live order execution disabled; any future change requires a separate security and risk review.

**Exit criteria:** reproducible research release with CI evidence and documented known limitations.

## 5. Immediate task order

1. Secure credentials and repository history.
2. Establish CI and baseline test coverage.
3. Define and validate the canonical candle schema.
4. Implement historical ingestion and deterministic replay.
5. Integrate official Kronos inference.
6. Build reproducible training/fine-tuning experiments only after data quality is proven.
7. Publish forecast evaluation and observability.

## 6. Definition of done

A milestone is complete only when its code, tests, reproducible evidence, limitations and documentation are committed. A README badge, simulated metric or successful process startup is not proof of model quality or operational readiness.
