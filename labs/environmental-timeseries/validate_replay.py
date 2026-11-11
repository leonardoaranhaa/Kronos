#!/usr/bin/env python3
"""Validate and deterministically replay a non-financial CSV time series."""

from __future__ import annotations

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
                parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                value = float(raw_value)
            except (ValueError, TypeError) as exc:
                raise ValueError(
                    f"line {line_number}: invalid timestamp or numeric value"
                ) from exc

            if parsed.tzinfo is None:
                raise ValueError(
                    f"line {line_number}: timestamp must include a timezone"
                )
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


def replay(points: list[Point]) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    previous_value: float | None = None
    for index, point in enumerate(points):
        events.append({
            "sequence": index,
            "timestamp": point.timestamp,
            "value": point.value,
            "delta": None if previous_value is None else point.value - previous_value,
        })
        previous_value = point.value
    return events


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"Usage: {Path(argv[0]).name} <csv-path>", file=sys.stderr)
        return 2
    try:
        points, digest = load_points(Path(argv[1]))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps({
        "status": "ok",
        "records": len(points),
        "sha256": digest,
        "replay": replay(points),
    }, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
