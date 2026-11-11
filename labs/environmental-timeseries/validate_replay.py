#!/usr/bin/env python3
"""Validate and deterministically replay a non-financial CSV time series."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass(frozen=True)
class Point:
    timestamp: str
    value: float


def parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a timezone")
    return parsed


def validate_gap_policy(expected_interval_seconds: float | None,
                        tolerance_seconds: float) -> None:
    if expected_interval_seconds is not None and (
        not math.isfinite(expected_interval_seconds) or expected_interval_seconds <= 0
    ):
        raise ValueError("expected interval must be a finite number greater than zero")
    if not math.isfinite(tolerance_seconds) or tolerance_seconds < 0:
        raise ValueError("gap tolerance must be a finite number greater than or equal to zero")


def load_points(path: Path) -> tuple[list[Point], str]:
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    text = raw.decode("utf-8")
    reader = csv.reader(io.StringIO(text, newline=""), strict=True)

    try:
        header = next(reader, None)
        if header != ["timestamp", "value"]:
            raise ValueError("CSV header must be exactly: timestamp,value")

        points: list[Point] = []
        previous: datetime | None = None

        for row in reader:
            line_number = reader.line_num
            if len(row) != 2:
                raise ValueError(
                    f"line {line_number}: expected exactly 2 columns (timestamp,value)"
                )

            timestamp, raw_value = row
            if not timestamp.strip() or not raw_value.strip():
                raise ValueError(
                    f"line {line_number}: timestamp and value are required"
                )

            try:
                parsed = parse_timestamp(timestamp)
                value = float(raw_value)
            except (ValueError, TypeError) as exc:
                raise ValueError(
                    f"line {line_number}: invalid timestamp or numeric value"
                ) from exc

            if not math.isfinite(value):
                raise ValueError(f"line {line_number}: value must be finite")
            if previous is not None and parsed <= previous:
                raise ValueError(
                    f"line {line_number}: timestamps must be strictly increasing"
                )

            points.append(Point(timestamp, value))
            previous = parsed

    except csv.Error as exc:
        raise ValueError(f"malformed CSV near line {reader.line_num}: {exc}") from exc

    if not points:
        raise ValueError("CSV must contain at least one data row")
    return points, digest


def replay(
    points: list[Point],
    expected_interval_seconds: float | None = None,
    tolerance_seconds: float = 0.0,
) -> list[dict[str, object]]:
    validate_gap_policy(expected_interval_seconds, tolerance_seconds)
    events: list[dict[str, object]] = []
    previous_value: float | None = None
    previous_timestamp: datetime | None = None
    allowed_gap = (
        None if expected_interval_seconds is None
        else expected_interval_seconds + tolerance_seconds
    )

    for index, point in enumerate(points):
        current_timestamp = parse_timestamp(point.timestamp)
        gap_seconds = (
            None
            if previous_timestamp is None
            else (current_timestamp - previous_timestamp).total_seconds()
        )
        if gap_seconds is None:
            gap_status = "baseline"
        elif allowed_gap is None:
            gap_status = "not_evaluated"
        elif gap_seconds > allowed_gap:
            gap_status = "exceeds_expected"
        else:
            gap_status = "within_expected"

        events.append({
            "sequence": index,
            "timestamp": point.timestamp,
            "value": point.value,
            "delta": None if previous_value is None else point.value - previous_value,
            "gap_seconds": gap_seconds,
            "gap_status": gap_status,
        })
        previous_value = point.value
        previous_timestamp = current_timestamp

    return events


def summarize_quality(events: list[dict[str, object]]) -> dict[str, object]:
    """Return deterministic descriptive quality metrics for validated samples."""
    values = [float(event["value"]) for event in events]
    gaps = [
        float(event["gap_seconds"])
        for event in events
        if event["gap_seconds"] is not None
    ]
    deltas = [
        float(event["delta"])
        for event in events
        if event["delta"] is not None
    ]
    out_of_range = sum(
        event["gap_status"] == "exceeds_expected" for event in events
    )
    absolute_deltas = [abs(delta) for delta in deltas]

    return {
        "record_count": len(values),
        "interval_count": len(gaps),
        "out_of_range_intervals": out_of_range,
        "max_gap_seconds": max(gaps) if gaps else None,
        "min_value": min(values),
        "max_value": max(values),
        "mean_value": math.fsum(values) / len(values),
        "max_absolute_delta": max(absolute_deltas) if absolute_deltas else None,
        "total_absolute_variation": math.fsum(absolute_deltas),
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate and replay a synthetic environmental time series."
    )
    parser.add_argument("csv_path", type=Path)
    parser.add_argument(
        "--expected-interval-seconds",
        type=float,
        default=None,
        help="Expected interval between samples; omit to report gaps without classifying them.",
    )
    parser.add_argument(
        "--tolerance-seconds",
        type=float,
        default=0.0,
        help="Additional allowed delay beyond the expected interval (default: 0).",
    )
    args = parser.parse_args(argv[1:])
    validate_gap_policy(args.expected_interval_seconds, args.tolerance_seconds)
    return args


def main(argv: list[str]) -> int:
    try:
        args = parse_args(argv)
        points, digest = load_points(args.csv_path)
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    events = replay(
        points,
        args.expected_interval_seconds,
        args.tolerance_seconds,
    )
    print(json.dumps({
        "status": "ok",
        "records": len(points),
        "sha256": digest,
        "expected_interval_seconds": args.expected_interval_seconds,
        "tolerance_seconds": args.tolerance_seconds,
        "quality": summarize_quality(events),
        "replay": events,
    }, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
