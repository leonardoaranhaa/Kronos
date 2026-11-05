#!/usr/bin/env python3
"""JSON-lines adapter for the official shiyu-coder/Kronos implementation.

This worker intentionally has no synthetic/random prediction fallback. If the
upstream source or pretrained weights are unavailable, it reports STATUS ERROR.
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch


UPSTREAM_COMMIT = os.getenv("KRONOS_UPSTREAM_COMMIT", "67b630e67f6a18c9e9be918d9b4337c960db1e9a")
MODEL_ID = os.getenv("KRONOS_MODEL_ID", "NeoQuasar/Kronos-small")
TOKENIZER_ID = os.getenv("KRONOS_TOKENIZER_ID", "NeoQuasar/Kronos-Tokenizer-base")
FREQ_MAP = {
    "1s": "1s", "1m": "1min", "3m": "3min", "5m": "5min",
    "15m": "15min", "30m": "30min", "1h": "1h", "2h": "2h",
    "4h": "4h", "6h": "6h", "8h": "8h", "12h": "12h",
    "1d": "1D", "3d": "3D", "1w": "7D"
}


def send(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


class KronosWorker:
    def __init__(self):
        repo_path = Path(os.getenv("KRONOS_REPO_PATH", "./external/Kronos")).resolve()
        if not (repo_path / "model" / "__init__.py").is_file():
            raise RuntimeError(
                "Official Kronos source not found. Run scripts/setup-kronos.sh "
                "and set KRONOS_REPO_PATH to that checkout."
            )

        sys.path.insert(0, str(repo_path))
        from model import Kronos, KronosTokenizer, KronosPredictor

        if torch.cuda.is_available():
            device = os.getenv("KRONOS_DEVICE", "cuda:0")
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = os.getenv("KRONOS_DEVICE", "mps")
        else:
            device = os.getenv("KRONOS_DEVICE", "cpu")

        self.device = device
        self.max_context = min(512, max(32, int(os.getenv("KRONOS_MAX_CONTEXT", "400"))))
        self.tokenizer = KronosTokenizer.from_pretrained(TOKENIZER_ID)
        self.model = Kronos.from_pretrained(MODEL_ID)
        self.model.eval()
        self.predictor = KronosPredictor(
            self.model, self.tokenizer, device=self.device, max_context=self.max_context
        )

    def predict(self, candles, interval, horizon, timestamp):
        if interval not in FREQ_MAP:
            raise ValueError(f"Unsupported interval for official Kronos adapter: {interval}")
        if len(candles) < 32:
            raise ValueError("At least 32 completed candles are required before inference")

        ordered = sorted(candles, key=lambda item: int(item["timestamp"]))
        timestamps = pd.Series(pd.to_datetime(
            [int(item["timestamp"]) for item in ordered], unit="ms", utc=True
        ))
        rows = []
        for item in ordered:
            open_price = float(item["open"])
            high_price = float(item["high"])
            low_price = float(item["low"])
            close_price = float(item["close"])
            volume = float(item["volume"])
            amount = item.get("quoteVolume")
            if amount is None:
                amount = volume * ((open_price + high_price + low_price + close_price) / 4.0)
            rows.append({
                "open": open_price, "high": high_price, "low": low_price,
                "close": close_price, "volume": volume, "amount": float(amount)
            })

        frame = pd.DataFrame(rows)
        last_timestamp = timestamps.iloc[-1]
        if interval == "1w":
            next_timestamp = last_timestamp + pd.Timedelta(days=7)
        else:
            next_timestamp = last_timestamp + pd.tseries.frequencies.to_offset(FREQ_MAP[interval])
        future_timestamps = pd.Series(pd.date_range(
            start=next_timestamp, periods=horizon, freq=FREQ_MAP[interval]
        ))

        # Fixed seed makes a given input reproducible on the same runtime/device.
        seed = int(timestamp) % (2 ** 31 - 1)
        torch.manual_seed(seed)
        np.random.seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)

        prediction = self.predictor.predict(
            df=frame,
            x_timestamp=timestamps,
            y_timestamp=future_timestamps,
            pred_len=horizon,
            T=1.0,
            top_p=0.9,
            sample_count=1,
            verbose=False
        )

        return {
            "type": "PREDICTION_RESULT",
            "requestId": str(timestamp),
            "timestamp": int(timestamp),
            "modelId": MODEL_ID,
            "tokenizerId": TOKENIZER_ID,
            "upstreamCommit": UPSTREAM_COMMIT,
            "device": self.device,
            "predictions": [float(value) for value in prediction["close"].tolist()],
            "forecast": prediction.reset_index(drop=True).to_dict(orient="records")
        }


def main():
    try:
        worker = KronosWorker()
    except Exception as exc:
        send({"type": "STATUS", "status": "ERROR", "error": str(exc)})
        return 1

    send({
        "type": "STATUS",
        "status": "READY",
        "device": worker.device,
        "modelId": MODEL_ID,
        "tokenizerId": TOKENIZER_ID,
        "upstreamCommit": UPSTREAM_COMMIT
    })

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
            if message.get("type") != "INFER":
                continue
            result = worker.predict(
                message.get("candles", []),
                str(message.get("interval", "5m")),
                max(1, min(64, int(message.get("horizon", 5)))),
                int(message.get("timestamp", 0))
            )
            result["requestId"] = message.get("requestId")
            send(result)
        except Exception as exc:
            send({
                "type": "ERROR",
                "requestId": message.get("requestId") if "message" in locals() else None,
                "error": str(exc)
            })

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
