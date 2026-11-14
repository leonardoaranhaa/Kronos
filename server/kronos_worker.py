#!/usr/bin/env python3
"""JSON-lines adapter for the official shiyu-coder/Kronos implementation.

This worker intentionally has no synthetic/random prediction fallback. If the
upstream source or pretrained weights are unavailable, it reports STATUS ERROR.
"""
import json
import os
import sys
import time
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


def denormalize_close_paths(samples, frame, horizon):
    """Return close paths shaped (sample_count, horizon), or None."""
    if samples is None:
        return None
    values = frame[["open", "high", "low", "close", "volume", "amount"]].to_numpy(dtype=np.float64)
    center = values.mean(axis=0)
    scale = values.std(axis=0)
    # samples: (batch, sample_count, seq, features). Close is feature 3.
    future = samples[0, :, -horizon:, 3]
    return future * (scale[3] + 1e-5) + center[3]


def summarize_close_paths(paths, last_close, sample_count):
    """paths: (samples, horizon) of denormalized closes.

    A single path is the mean forecast, not a probability. P(alta) and the
    quantile band stay empty until at least two paths were sampled.
    """
    enough = int(sample_count) >= 2 and paths is not None and len(paths) >= 2
    if not enough:
        return {
            "samplePaths": [],
            "sampleEnds": [],
            "quantileBand": None,
            "pUp": None,
            "probabilityAvailable": False,
            "probabilityNote": "sem amostras suficientes",
        }
    band = {
        "p10": [float(value) for value in np.quantile(paths, 0.10, axis=0)],
        "p50": [float(value) for value in np.quantile(paths, 0.50, axis=0)],
        "p90": [float(value) for value in np.quantile(paths, 0.90, axis=0)],
    }
    ends = paths[:, -1]
    return {
        "samplePaths": [[float(value) for value in row] for row in paths],
        "sampleEnds": [float(value) for value in ends],
        "quantileBand": band,
        "pUp": float(np.mean(ends > last_close)),
        "probabilityAvailable": True,
        "probabilityNote": None,
    }


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

        configured_device = os.getenv("KRONOS_DEVICE") or None
        if configured_device:
            device = configured_device
        elif torch.cuda.is_available():
            device = "cuda:0"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"

        self.device = device
        self.max_context = min(512, max(32, int(os.getenv("KRONOS_MAX_CONTEXT", "400"))))
        self.tokenizer = KronosTokenizer.from_pretrained(TOKENIZER_ID)
        self.model = Kronos.from_pretrained(MODEL_ID)
        self.predictor = KronosPredictor(
            self.model, self.tokenizer, device=self.device, max_context=self.max_context
        )
        # Predictor.to(device) does not leave training mode. Dropout must be off
        # for inference (upstream PRs #382 and #407). Set KRONOS_TOKENIZER_EVAL=0
        # only to reproduce the milestone-2 worker, which left the tokenizer in train().
        self.model.eval()
        if os.getenv("KRONOS_TOKENIZER_EVAL", "1") == "0":
            self.tokenizer.train()
        else:
            self.tokenizer.eval()
        self.sample_count = 1

    def predict(self, candles, interval, horizon, timestamp, sample_count=1):
        self.sample_count = max(1, min(8, int(sample_count)))
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

        sample_count = self.sample_count
        captured = {}
        # Upstream averages sample_count paths before returning them. The mean
        # stays the official forecast. The raw paths are kept only so research
        # can measure dispersion. The live path uses sample_count 1 and does
        # not patch anything.
        if sample_count > 1:
            import model.kronos as kronos_module
            original_mean = kronos_module.np.mean

            def capturing_mean(values, axis=None, *args, **kwargs):
                if (
                    isinstance(values, np.ndarray)
                    and values.ndim == 4
                    and axis == 1
                    and values.shape[1] == sample_count
                ):
                    captured["samples"] = np.array(values, copy=True)
                return original_mean(values, axis=axis, *args, **kwargs)

            kronos_module.np.mean = capturing_mean
        try:
            prediction = self.predictor.predict(
                df=frame,
                x_timestamp=timestamps,
                y_timestamp=future_timestamps,
                pred_len=horizon,
                T=1.0,
                top_p=0.9,
                sample_count=sample_count,
                verbose=False
            )
        finally:
            if sample_count > 1:
                kronos_module.np.mean = original_mean

        mean_closes = [float(value) for value in prediction["close"].tolist()]
        paths = denormalize_close_paths(captured.get("samples"), frame, horizon) if sample_count > 1 else None
        distribution = summarize_close_paths(paths, float(frame["close"].iloc[-1]), sample_count)

        return {
            "type": "PREDICTION_RESULT",
            "requestId": str(timestamp),
            "timestamp": int(timestamp),
            "modelId": MODEL_ID,
            "tokenizerId": TOKENIZER_ID,
            "upstreamCommit": UPSTREAM_COMMIT,
            "device": self.device,
            "modelEval": not self.model.training,
            "tokenizerEval": not self.tokenizer.training,
            "sampleCount": sample_count,
            "predictions": mean_closes,
            "sampleEnds": distribution["sampleEnds"],
            "samplePaths": distribution["samplePaths"],
            "quantileBand": distribution["quantileBand"],
            "pUp": distribution["pUp"],
            "probabilityAvailable": distribution["probabilityAvailable"],
            "probabilityNote": distribution["probabilityNote"],
            "forecast": prediction.reset_index(drop=True).to_dict(orient="records")
        }

    def predict_batch(self, series, interval, horizon, sample_count=1):
        """Score several equal-length windows in one predict_batch call."""
        if len(series) == 0:
            raise ValueError("predict_batch needs at least one series")
        frames = []
        x_stamps = []
        y_stamps = []
        ids = []
        for item in series:
            candles = item["candles"]
            ordered = sorted(candles, key=lambda row: int(row["timestamp"]))
            stamps = pd.Series(pd.to_datetime([int(row["timestamp"]) for row in ordered], unit="ms", utc=True))
            rows = []
            for row in ordered:
                volume = float(row["volume"])
                amount = row.get("quoteVolume")
                o, h, l, c = float(row["open"]), float(row["high"]), float(row["low"]), float(row["close"])
                if amount is None:
                    amount = volume * ((o + h + l + c) / 4.0)
                rows.append({"open": o, "high": h, "low": l, "close": c, "volume": volume, "amount": float(amount)})
            frame = pd.DataFrame(rows)
            frames.append(frame)
            x_stamps.append(stamps)
            last = stamps.iloc[-1]
            freq = FREQ_MAP[interval]
            nxt = last + (pd.Timedelta(days=7) if interval == "1w" else pd.tseries.frequencies.to_offset(freq))
            y_stamps.append(pd.Series(pd.date_range(start=nxt, periods=horizon, freq=freq)))
            ids.append(str(item.get("requestId", ordered[-1]["timestamp"])))

        seed = int(series[0].get("timestamp", 0)) % (2 ** 31 - 1)
        torch.manual_seed(seed)
        np.random.seed(seed)
        predictions = self.predictor.predict_batch(
            df_list=frames,
            x_timestamp_list=x_stamps,
            y_timestamp_list=y_stamps,
            pred_len=horizon,
            T=1.0,
            top_p=0.9,
            sample_count=max(1, min(8, int(sample_count))),
            verbose=False,
        )
        return [
            {
                "requestId": request_id,
                "predictions": [float(value) for value in frame["close"].tolist()],
            }
            for request_id, frame in zip(ids, predictions)
        ]


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
        "upstreamCommit": UPSTREAM_COMMIT,
        "modelEval": not worker.model.training,
        "tokenizerEval": not worker.tokenizer.training
    })

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
            kind = message.get("type")
            if kind == "BATCH_INFER":
                started = time.perf_counter()
                results = worker.predict_batch(
                    message.get("series", []),
                    str(message.get("interval", "1h")),
                    max(1, min(64, int(message.get("horizon", 6)))),
                    max(1, min(8, int(message.get("sampleCount", 1)))),
                )
                send({
                    "type": "BATCH_RESULT",
                    "requestId": message.get("requestId"),
                    "elapsedMs": round((time.perf_counter() - started) * 1000, 1),
                    "results": results,
                })
                continue
            if kind != "INFER":
                continue
            result = worker.predict(
                message.get("candles", []),
                str(message.get("interval", "5m")),
                max(1, min(64, int(message.get("horizon", 5)))),
                int(message.get("timestamp", 0)),
                max(1, min(8, int(message.get("sampleCount", 1))))
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
