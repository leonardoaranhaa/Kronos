# server/kronos_worker.py
import sys
import json
import torch
import numpy as np

class KronosWorker:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.initialized = True

    def predict_horizon(self, candles: list, horizon: int = 5) -> list:
        if not candles or len(candles) == 0:
            return []

        closes = [float(c['close']) for c in candles]
        last_close = closes[-1]

        returns = np.diff(closes) / closes[:-1] if len(closes) > 1 else [0]
        volatility = np.std(returns) if len(returns) > 0 else 0.0015
        mean_drift = np.mean(returns) if len(returns) > 0 else 0.0

        predictions = []
        current = last_close
        for i in range(1, horizon + 1):
            noise = np.random.normal(mean_drift, volatility)
            current = current * (1 + noise)
            predictions.append(round(float(current), 2))

        return predictions

def main():
    worker = KronosWorker()
    sys.stdout.write(json.dumps({"type": "STATUS", "status": "READY", "device": worker.device}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line.strip())
            if message.get("type") == "INFER":
                candles = message.get("candles", [])
                horizon = message.get("horizon", 5)
                
                predicted_closes = worker.predict_horizon(candles, horizon)
                
                response = {
                    "type": "PREDICTION_RESULT",
                    "timestamp": message.get("timestamp"),
                    "predictions": predicted_closes
                }
                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()
        except Exception as e:
            sys.stdout.write(json.dumps({"type": "ERROR", "error": str(e)}) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
