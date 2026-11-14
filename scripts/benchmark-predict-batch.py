"""CPU throughput: three equal windows, one at a time versus predict_batch.

Uses the pinned predictor. sample_count is 1 so the timing is the batching itself.
"""
import json
import os
import time
from pathlib import Path

os.environ.setdefault("KRONOS_DEVICE", "cpu")
os.environ.setdefault("KRONOS_REPO_PATH", "external/Kronos")

import importlib.util

spec = importlib.util.spec_from_file_location("kronos_worker", "server/kronos_worker.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

CONTEXT = 256
HORIZON = 6
REPEATS = 3


def window(symbol):
    path = sorted(Path("data/normalized").glob(f"{symbol}_1h_*.jsonl"))[-1]
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    chunk = rows[-CONTEXT:]
    return [{
        "timestamp": row["openTime"],
        "open": row["open"],
        "high": row["high"],
        "low": row["low"],
        "close": row["close"],
        "volume": row["volume"],
        "quoteVolume": row.get("quoteVolume"),
    } for row in chunk]


def main():
    worker = mod.KronosWorker()
    series = [{"candles": window(symbol), "requestId": symbol, "timestamp": 1} for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT")]
    # One warmup call so weights are resident.
    worker.predict(series[0]["candles"], "1h", HORIZON, 1, 1)

    sequential = []
    for _ in range(REPEATS):
        started = time.perf_counter()
        for item in series:
            worker.predict(item["candles"], "1h", HORIZON, item["timestamp"], 1)
        sequential.append(time.perf_counter() - started)

    batched = []
    for _ in range(REPEATS):
        started = time.perf_counter()
        worker.predict_batch(series, "1h", HORIZON, 1)
        batched.append(time.perf_counter() - started)

    print(json.dumps({
        "pairs": 3,
        "context": CONTEXT,
        "horizon": HORIZON,
        "sampleCount": 1,
        "repeats": REPEATS,
        "sequentialSeconds": [round(value, 3) for value in sequential],
        "batchSeconds": [round(value, 3) for value in batched],
        "sequentialMean": round(sum(sequential) / len(sequential), 3),
        "batchMean": round(sum(batched) / len(batched), 3),
        "modelEval": not worker.model.training,
        "tokenizerEval": not worker.tokenizer.training,
    }, indent=2))


if __name__ == "__main__":
    main()
