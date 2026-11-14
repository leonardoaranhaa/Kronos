"""RoPE positions in cross-attention.

Upstream Kronos at 67b630e builds the cos/sin table from the query length.
decode_s2 passes one query against the whole context, so every key is rotated
by position 0. These tests are the contract from shiyu-coder/Kronos#425.
They fail on the unpatched checkout and pass after patches/kronos-rope-425.patch.
"""
import os
import sys
from pathlib import Path

import torch

REPO = Path(os.environ.get("KRONOS_REPO_PATH", "external/Kronos")).resolve()
sys.path.insert(0, str(REPO))

from model import Kronos  # noqa: E402
from model.module import RotaryPositionalEmbedding  # noqa: E402


def manual_rotate(x, positions, inv_freq):
    freqs = torch.einsum("l,j->lj", positions.float(), inv_freq)
    emb = torch.cat((freqs, freqs), dim=-1)
    cos, sin = emb.cos()[None, None], emb.sin()[None, None]
    x1, x2 = x.chunk(2, dim=-1)
    return x * cos + torch.cat((-x2, x1), dim=-1) * sin


def test_full_length_rotation_matches_manual_rope():
    rotary = RotaryPositionalEmbedding(dim=8)
    q = torch.randn(2, 3, 7, 8)
    k = torch.randn(2, 3, 7, 8)
    q_rot, k_rot = rotary(q, k)
    positions = torch.arange(7)
    assert torch.allclose(q_rot, manual_rotate(q, positions, rotary.inv_freq), atol=1e-6)
    assert torch.allclose(k_rot, manual_rotate(k, positions, rotary.inv_freq), atol=1e-6)


def test_single_query_uses_last_position_and_keys_keep_theirs():
    rotary = RotaryPositionalEmbedding(dim=8)
    seq_len = 10
    q = torch.randn(1, 1, 1, 8)
    k = torch.randn(1, 1, seq_len, 8)
    q_rot, k_rot = rotary(q, k)
    assert torch.allclose(q_rot, manual_rotate(q, torch.tensor([seq_len - 1]), rotary.inv_freq), atol=1e-6)
    assert torch.allclose(k_rot, manual_rotate(k, torch.arange(seq_len), rotary.inv_freq), atol=1e-6)
    assert not torch.allclose(k_rot, k, atol=1e-5)


def test_decode_s2_last_position_matches_full_length_query():
    torch.manual_seed(123)
    model = Kronos(
        s1_bits=4, s2_bits=4, n_layers=2, d_model=32, n_heads=4, ff_dim=64,
        ffn_dropout_p=0.0, attn_dropout_p=0.0, resid_dropout_p=0.0,
        token_dropout_p=0.0, learn_te=False,
    ).eval()
    batch_size, seq_len = 2, 12
    s1_ids = torch.randint(0, 16, (batch_size, seq_len))
    s2_ids = torch.randint(0, 16, (batch_size, seq_len))
    stamp = torch.randint(0, 5, (batch_size, seq_len, 5)).float()
    with torch.no_grad():
        _, context = model.decode_s1(s1_ids, s2_ids, stamp)
        next_s1 = torch.randint(0, 16, (batch_size, 1))
        s2_logits = model.decode_s2(context, next_s1)[:, -1:, :]
        sibling_full = model.embedding.emb_s1(next_s1).expand(batch_size, seq_len, model.embedding.d_model)
        reference = model.head.cond_forward(model.dep_layer(context, sibling_full))[:, -1:, :]
    assert torch.allclose(s2_logits, reference, atol=1e-5)


if __name__ == "__main__":
    tests = [
        test_full_length_rotation_matches_manual_rope,
        test_single_query_uses_last_position_and_keys_keep_theirs,
        test_decode_s2_last_position_matches_full_length_query,
    ]
    failed = 0
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except Exception as exc:
            failed += 1
            print(f"FAIL {test.__name__}: {exc}")
    raise SystemExit(1 if failed else 0)
