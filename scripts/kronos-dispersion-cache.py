"""Fill a Kronos dispersion cache with more sample paths than the live worker uses.

Reads a job file written by `npm run validate -- --strategy kronos-vol-job -- --samples N`:
the klines file, the exact decision openTimes, the context, the horizon and the dataset key.
Calls the official KronosWorker (same seed per timestamp, same T and top_p) and appends
{openTime, meanCloses, sampleEnds, datasetSha256} rows, resuming where the cache stops.
No order, no key, no network besides the first weight download.
"""
import json
import os
import sys
import time
import importlib.util

os.environ.setdefault("KRONOS_DEVICE", "cpu")
os.environ.setdefault("KRONOS_REPO_PATH", "external/Kronos")


def main():
    job = json.load(open(sys.argv[1]))
    os.environ["KRONOS_MAX_SAMPLES"] = str(job["sampleCount"])
    spec = importlib.util.spec_from_file_location("kronos_worker", "server/kronos_worker.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    bars = [json.loads(line) for line in open(job["klinesFile"]) if line.strip()]
    bars = [bar for bar in bars if job["windowStartMs"] <= bar["openTime"] < job["windowEndMs"]]
    bars.sort(key=lambda bar: bar["openTime"])
    position = {bar["openTime"]: index for index, bar in enumerate(bars)}
    done = set()
    if os.path.exists(job["cacheFile"]):
        for line in open(job["cacheFile"]):
            if line.strip():
                row = json.loads(line)
                if row.get("datasetSha256") == job["datasetSha256"]:
                    done.add(row["openTime"])
    worker = mod.KronosWorker()
    todo = [t for t in job["openTimes"] if t not in done]
    started = time.time()
    with open(job["cacheFile"], "a") as out:
        for count, open_time in enumerate(todo, 1):
            index = position[open_time]
            window = bars[index - job["context"] + 1: index + 1]
            candles = [{
                "timestamp": bar["openTime"], "open": bar["open"], "high": bar["high"], "low": bar["low"],
                "close": bar["close"], "volume": bar["volume"], "quoteVolume": bar.get("quoteVolume"),
            } for bar in window]
            result = worker.predict(candles, "1h", job["horizon"], open_time, job["sampleCount"])
            if len(result["sampleEnds"]) != job["sampleCount"]:
                raise RuntimeError(f"{open_time}: {len(result['sampleEnds'])} amostras, esperado {job['sampleCount']}")
            out.write(json.dumps({
                "openTime": open_time,
                "meanCloses": result["predictions"],
                "sampleEnds": result["sampleEnds"],
                "datasetSha256": job["datasetSha256"],
            }) + "\n")
            out.flush()
            if count % 50 == 0:
                rate = (time.time() - started) / count
                print(f"{count}/{len(todo)} previsões, {rate:.1f} s cada, faltam {rate * (len(todo) - count) / 3600:.1f} h", flush=True)
    print(f"pronto: {len(todo)} previsões novas", flush=True)


if __name__ == "__main__":
    main()
