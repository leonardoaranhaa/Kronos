# KRONOS — Engineering Plan

**Status:** P1 data contract and validation implementation in progress  
**Baseline:** `main` — package metadata version 1.3.0  
**Working branch:** `engineering/foundation-audit`  
**Scope:** Research, data integrity, model integration, validation and observability. Live financial execution remains disabled.

## 1. Engineering principles

1. The official `shiyu-coder/Kronos` implementation, tokenizer and compatible pretrained weights are the source of truth.
2. Historical market data must be reproducible, timestamped, validated and versioned.
3. No random fallback may be presented as a model prediction.
4. No synthetic VPIN, OFI, PnL, win rate or confidence may be presented as observed evidence.
5. Model predictions, strategy hypotheses and measured outcomes remain separate records.
6. Experiments use chronological train/validation/test splits and prevent look-ahead leakage.
7. No production API credentials, live order routing or real-money execution in these milestones.

## 2. Confirmed baseline findings

- `server/kronos_worker.py` currently estimates future closes using random samples from recent returns; it does not load the official Kronos model or tokenizer.
- `server/kronos-bridge.ts` sends up to 50 candles to Python but lacks request correlation, bounded buffering, readiness gating and robust process lifecycle handling.
- `server/index.ts` generates VPIN and OFI with random values; these are not genuine order-flow analytics.
- `server/market-feed.ts` implements synthetic replay only; its `binance` mode has no Binance connection.
- `server/indicators.ts` embeds heuristic confidence and position-sizing logic; these are not calibrated probabilities.
- `server/monte_carlo.ts` uses synthetic prices and hard-coded/random outcome assumptions, including a 96.5% win probability; it is not a historical backtest.
- `server/order_execution.ts` contains signed order-submission code and can report `EXECUTED` even if protective OCO submission fails. Keep it disconnected.
- `.env.example` contained credential-like values. Treat them as compromised if ever valid; rotate/revoke them and inspect repository history. The engineering branch replaces them with placeholders.

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

## 4. Delivery phases

### P0 — Repository and security baseline
- [x] Create isolated engineering branch.
- [x] Replace credential-like values in `.env.example` with placeholders.
- [x] Document baseline findings and engineering gates.
- [ ] Review repository history for credential exposure and rotate affected keys.
- [ ] Add CI checks for secrets, formatting, type checking and tests.

### P1 — Data ingestion and historical candle integrity
- [x] Define canonical candle schema: venue, symbol, interval, open/close time, OHLCV, source and ingestion timestamp.
- [x] Validate OHLC relationships, positive prices, non-negative volume and interval semantics.
- [x] Audit series for duplicate timestamps, missing intervals and mixed series metadata.
- [ ] Define candle-finalization semantics; open-candle updates must not become duplicate completed candles.
- [ ] Implement historical import with pagination, rate limits, resumability and provenance.
- [ ] Persist immutable raw data and normalized datasets separately.
- [ ] Add deterministic replay from stored data.

**Exit criteria:** datasets can be rebuilt and audited; quality reports identify gaps, duplicates and rejected rows.

### P2 — Official Kronos integration
- [ ] Pin upstream source revision and document license/model provenance.
- [ ] Select compatible pretrained model/tokenizer for hardware and sequence requirements.
- [ ] Implement adapter around official inference API; do not speculate about internals.
- [ ] Remove random prediction fallback; return explicit unavailable/error state.
- [ ] Add input validation, normalization parity, model version and inference metadata.
- [ ] Compare adapter output with upstream examples.

### P3 — Training and fine-tuning
- [ ] Establish whether fine-tuning is justified; pretrained inference is the baseline.
- [ ] Define instrument/timeframe datasets and minimum data requirements.
- [ ] Use chronological splits and documented leakage policy.
- [ ] Record configuration, seeds, data snapshot, code revision and artifact hashes.
- [ ] Compare pretrained and fine-tuned variants with simple baselines.
- [ ] Track compute, memory, training duration and artifact lineage.

### P4 — Evaluation
- [ ] Evaluate forecast errors by horizon and regime (MAE, RMSE, scale-aware metrics).
- [ ] Compare against persistence and simple statistical baselines.
- [ ] Report uncertainty/calibration only when methodologically supported.
- [ ] Keep forecast evaluation separate from hypothetical strategy simulation.
- [ ] Document fees, spread, slippage and funding in any later approved research simulation.

### P5 — Observability
- [ ] Expose feed mode, data freshness, candle completeness and ingestion lag.
- [ ] Expose model readiness, version, inference latency and error rate.
- [ ] Persist predictions and subsequent observed outcomes.
- [ ] Add structured logs, health checks, graceful shutdown and bounded queues.
- [ ] Label synthetic, replay and genuine market sources distinctly.

### P6 — Release hardening
- [ ] Add unit, integration, contract and regression tests.
- [ ] Validate clean installation and production build in CI.
- [ ] Review dependency and secret-management posture.
- [ ] Document setup, data refresh, model acquisition, reproducibility and recovery.
- [ ] Keep live order execution disabled; any future change requires separate review.

## 5. Immediate order

1. Secure credentials and inspect repository history.
2. Establish CI and baseline test coverage.
3. Define and validate canonical candle schema.
4. Implement historical ingestion and deterministic replay.
5. Integrate official Kronos inference.
6. Run reproducible training/fine-tuning only after data quality is proven.
7. Publish evaluation and observability.

## 6. Definition of done

A milestone is complete only with committed code, tests, reproducible evidence, limitations and documentation. Simulated metrics or successful startup do not prove model quality or operational readiness.
