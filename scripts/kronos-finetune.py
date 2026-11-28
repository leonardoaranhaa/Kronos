"""Fine-tune the Kronos-small predictor on BTCUSDT 1h, only on data before the test window.

Same objective and loop as upstream finetune_csv/finetune_base_model.py (next-token
cross-entropy on the frozen pretrained tokenizer's codes, AdamW, OneCycle, grad clip 3),
without DDP. The tokenizer is not trained.

Fixed before any result (kronos-ft-v1 in server/volatility/kronos-combo.ts):
  data:   data/finetune/BTCUSDT_1h_2020-01_2024-10.csv (ends 2024-10-31 23:00 UTC,
          the test window starts 2024-11-01)
  split:  first 90% train, last 10% validation, by time
  window: lookback 256 + predict 6 (the frozen research spec), per-window z-score, clip 5
  optim:  lr 4e-5 (upstream qlib config), betas (0.9, 0.95), weight decay 0.1, batch 16
  epochs: 2; best validation loss is kept
Writes models/kronos-small-btc1h/ (config + weights) and a JSON manifest next to it.

Usage: .venv/bin/python scripts/kronos-finetune.py [--steps N]   (N > 0 only for a timing probe)
"""
import argparse
import hashlib
import json
import os
import sys
import time

import numpy as np
import pandas as pd
import torch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "external", "Kronos"))
from model import Kronos, KronosTokenizer  # noqa: E402

DATA = "data/finetune/BTCUSDT_1h_2020-01_2024-10.csv"
OUT = "models/kronos-small-btc1h"
LOOKBACK, PREDICT, CLIP = 256, 6, 5.0
TRAIN_RATIO = 0.9
LR, BETAS, WEIGHT_DECAY, BATCH, EPOCHS, SEED = 4e-5, (0.9, 0.95), 0.1, 16, 2, 42
FEATURES = ["open", "high", "low", "close", "volume", "amount"]
TIME_FEATURES = ["minute", "hour", "weekday", "day", "month"]


def load_frame():
    frame = pd.read_csv(DATA)
    stamps = pd.to_datetime(frame["timestamps"])
    frame["minute"] = stamps.dt.minute
    frame["hour"] = stamps.dt.hour
    frame["weekday"] = stamps.dt.weekday
    frame["day"] = stamps.dt.day
    frame["month"] = stamps.dt.month
    if stamps.max() >= pd.Timestamp("2024-11-01"):
        raise SystemExit("o arquivo de treino invade a janela de teste")
    return frame


class Windows(torch.utils.data.Dataset):
    def __init__(self, values, stamps, starts):
        self.values, self.stamps, self.starts = values, stamps, starts

    def __len__(self):
        return len(self.starts)

    def __getitem__(self, index):
        start = self.starts[index]
        end = start + LOOKBACK + PREDICT
        x = self.values[start:end]
        x = (x - x.mean(axis=0)) / (x.std(axis=0) + 1e-5)
        x = np.clip(x, -CLIP, CLIP)
        return torch.from_numpy(x.astype(np.float32)), torch.from_numpy(self.stamps[start:end].astype(np.float32))


def batch_loss(model, tokenizer, x, stamp):
    with torch.no_grad():
        s0, s1 = tokenizer.encode(x, half=True)
    logits = model(s0[:, :-1], s1[:, :-1], stamp[:, :-1, :])
    loss, _, _ = model.head.compute_loss(logits[0], logits[1], s0[:, 1:], s1[:, 1:])
    return loss


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", type=int, default=0, help="stop after N steps (timing probe, nothing saved)")
    args = parser.parse_args()
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    frame = load_frame()
    values = frame[FEATURES].to_numpy(np.float64)
    stamps = frame[TIME_FEATURES].to_numpy(np.float64)
    window = LOOKBACK + PREDICT
    split = int(len(frame) * TRAIN_RATIO)
    # A validation window never starts inside the training rows' reach.
    train_starts = list(range(0, split - window + 1))
    val_starts = list(range(split, len(frame) - window + 1, PREDICT))
    train = torch.utils.data.DataLoader(Windows(values, stamps, train_starts), batch_size=BATCH, shuffle=True,
                                        generator=torch.Generator().manual_seed(SEED), drop_last=True)
    val = torch.utils.data.DataLoader(Windows(values, stamps, val_starts), batch_size=BATCH, shuffle=False)

    tokenizer = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base").eval()
    model = Kronos.from_pretrained("NeoQuasar/Kronos-small")
    for parameter in tokenizer.parameters():
        parameter.requires_grad_(False)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, betas=BETAS, weight_decay=WEIGHT_DECAY)
    total = args.steps or EPOCHS * len(train)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=LR, total_steps=total, pct_start=0.03, div_factor=10)

    def validate():
        model.eval()
        losses = []
        with torch.no_grad():
            for x, stamp in val:
                losses.append(batch_loss(model, tokenizer, x, stamp).item())
        model.train()
        return float(np.mean(losses))

    baseline = None if args.steps else validate()
    print(f"treino {len(train_starts)} janelas, validação {len(val_starts)}; perda de validação antes: {baseline}", flush=True)
    best, history, step, started = baseline if baseline is not None else float("inf"), [], 0, time.time()
    model.train()
    for epoch in range(EPOCHS):
        for x, stamp in train:
            loss = batch_loss(model, tokenizer, x, stamp)
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=3.0)
            optimizer.step()
            scheduler.step()
            step += 1
            if step % 100 == 0 or (args.steps and step == args.steps):
                rate = (time.time() - started) / step
                print(f"passo {step}/{total}, perda {loss.item():.4f}, {rate:.2f} s/passo, faltam {rate * (total - step) / 3600:.1f} h", flush=True)
            if args.steps and step >= args.steps:
                return
        current = validate()
        history.append({"epoch": epoch + 1, "validation": current})
        print(f"época {epoch + 1}: perda de validação {current:.4f} (melhor {best:.4f})", flush=True)
        if current < best:
            best = current
            os.makedirs(OUT, exist_ok=True)
            model.save_pretrained(OUT)
    digest = hashlib.sha256(open(DATA, "rb").read()).hexdigest()
    manifest = {
        "protocol": "kronos-ft-v1", "data": DATA, "dataSha256": digest, "lookback": LOOKBACK, "predict": PREDICT,
        "trainRatio": TRAIN_RATIO, "lr": LR, "batch": BATCH, "epochs": EPOCHS, "seed": SEED,
        "baselineValidation": baseline, "history": history, "bestValidation": best,
        "improved": best < baseline, "torch": torch.__version__,
    }
    os.makedirs(OUT, exist_ok=True)
    json.dump(manifest, open(os.path.join(OUT, "finetune-manifest.json"), "w"), indent=2)
    print(json.dumps(manifest), flush=True)


if __name__ == "__main__":
    main()
