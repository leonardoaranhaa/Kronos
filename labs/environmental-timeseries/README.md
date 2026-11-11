# Environmental Time-Series Lab

This isolated lab validates the KRONOS data-engineering concepts against synthetic environmental measurements. It is not connected to market feeds, trading logic, model inference, or order execution.

## Data contract

CSV columns: `timestamp,value`.

- Timestamps must be ISO-8601 strings and strictly increasing.
- Values must be finite numbers.
- Empty files, malformed rows, duplicate timestamps, and out-of-order rows are rejected.

## Run

From the repository root:

```bash
python labs/environmental-timeseries/validate_replay.py labs/environmental-timeseries/sample.csv
python -m unittest discover -s labs/environmental-timeseries -p 'test_*.py'
```

The validator prints a SHA-256 digest of the exact input bytes and a deterministic replay summary. No network access or third-party Python packages are required.
