# Environmental Time-Series Lab

This isolated lab validates and replays synthetic environmental measurements. It is not connected to market feeds, trading logic, model inference, or order execution.

## Data contract

CSV columns: timestamp,value.

- The header must match exactly: timestamp,value.
- At least one data row is required.
- Every data row must contain exactly two columns; missing or extra columns are rejected.
- Neither field may be empty.
- Timestamps must be ISO-8601 strings with a timezone and strictly increasing.
- Values must be finite numbers.
- Invalid UTF-8 and malformed CSV quoting are rejected.

## Replay output

Each record includes its sequence, original timestamp, numeric value, value delta, elapsed time since the previous sample (gap_seconds), and a gap_status.

- baseline: first record; no preceding interval exists.
- not_evaluated: no expected interval was configured.
- within_expected: elapsed time is at or below the configured interval plus tolerance.
- exceeds_expected: elapsed time exceeds that limit.

The validator reports gaps; it does not discard or modify measurements. Timestamps are timezone-aware, so elapsed time is calculated between actual instants even when UTC offsets differ.

## Configure the expected cadence

The policy is optional. Without it, the replay reports elapsed time and labels subsequent gaps not_evaluated.

Example: expect one sample per hour and allow five additional minutes:

    python labs/environmental-timeseries/validate_replay.py labs/environmental-timeseries/sample.csv --expected-interval-seconds 3600 --tolerance-seconds 300

The expected interval must be finite and greater than zero; tolerance must be finite and non-negative. A gap above the threshold is flagged in the output, not treated as a parsing failure.

## Run tests

From the repository root:

    python labs/environmental-timeseries/validate_replay.py labs/environmental-timeseries/sample.csv
    python -m unittest discover -s labs/environmental-timeseries -p 'test_*.py'

The validator prints a SHA-256 digest of the exact input bytes and a deterministic replay summary. No network access or third-party Python packages are required.
