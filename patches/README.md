# Local patches on the pinned Kronos checkout

Upstream `shiyu-coder/Kronos` stays at `67b630e67f6a18c9e9be918d9b4337c960db1e9a`. `scripts/setup-kronos.sh` checks out that commit and then applies every `patches/*.patch`. These are not a pin bump. Hugging Face weights are unchanged.

| Patch | Source | What it changes |
| --- | --- | --- |
| `kronos-rope-425.patch` | Unmerged PR [#425](https://github.com/shiyu-coder/Kronos/pull/425), issue [#423](https://github.com/shiyu-coder/Kronos/issues/423) | In `decode_s2` a one-token query made the RoPE tables length 1, so every key was rotated as position 0. Keys now use positions `0..k_len-1` and the query uses the last `q_len` positions. Equal lengths stay the same. |

Not applied:

- PR #253. It was a false positive and is not part of this layer.
- The KV cache in PR #393. It was skipped because this checkout does not show it is numerically identical to the current loop.
- PR #395 / #393 `return_samples` ideas are implemented in `server/kronos_worker.py` instead of patching upstream. The public `predict` still averages samples; the worker keeps the paths before that average.
- PR #382 / #407 `.eval()` is applied in our worker after `KronosPredictor` is built, not by editing the pinned predictor. The Hugging Face weights may predate the leakage fixes discussed in issues #307 and #422.

`tests/test_rope_positions.py` fails on the unpatched checkout and passes after this patch. It needs the local virtualenv and `external/Kronos`.
