import tempfile
import unittest
from pathlib import Path

from validate_replay import load_points, replay, validate_gap_policy


class TimeSeriesLabTests(unittest.TestCase):
    def write_csv(self, content: str) -> Path:
        temp = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".csv", delete=False)
        with temp:
            temp.write(content)
        self.addCleanup(Path(temp.name).unlink, missing_ok=True)
        return Path(temp.name)

    def write_bytes(self, content: bytes) -> Path:
        temp = tempfile.NamedTemporaryFile(mode="wb", suffix=".csv", delete=False)
        with temp:
            temp.write(content)
        self.addCleanup(Path(temp.name).unlink, missing_ok=True)
        return Path(temp.name)

    def test_valid_data_hashes_and_replays_deterministically(self):
        path = self.write_csv(
            "timestamp,value\n"
            "2026-01-01T00:00:00Z,10\n"
            "2026-01-01T01:00:00Z,12.5\n"
        )
        points_a, hash_a = load_points(path)
        points_b, hash_b = load_points(path)
        self.assertEqual(hash_a, hash_b)
        self.assertEqual(replay(points_a), replay(points_b))
        self.assertEqual(replay(points_a)[1]["delta"], 2.5)
        self.assertEqual(replay(points_a)[1]["gap_seconds"], 3600.0)

    def test_reports_elapsed_time_for_irregular_samples_and_normalizes_offsets(self):
        path = self.write_csv(
            "timestamp,value\n"
            "2026-01-01T00:00:00Z,10\n"
            "2026-01-01T02:30:00+01:00,11\n"
        )
        points, _ = load_points(path)
        events = replay(points)
        self.assertIsNone(events[0]["gap_seconds"])
        self.assertEqual(events[1]["gap_seconds"], 5400.0)

    def test_rejects_duplicate_or_out_of_order_timestamps(self):
        path = self.write_csv(
            "timestamp,value\n"
            "2026-01-01T01:00:00Z,10\n"
            "2026-01-01T01:00:00Z,11\n"
        )
        with self.assertRaisesRegex(ValueError, "strictly increasing"):
            load_points(path)

    def test_rejects_non_finite_values(self):
        path = self.write_csv("timestamp,value\n2026-01-01T00:00:00Z,nan\n")
        with self.assertRaisesRegex(ValueError, "finite"):
            load_points(path)

    def test_rejects_timezone_free_timestamps(self):
        path = self.write_csv("timestamp,value\n2026-01-01T00:00:00,10\n")
        with self.assertRaisesRegex(ValueError, "invalid timestamp or numeric value"):
            load_points(path)

    def test_rejects_empty_file(self):
        path = self.write_csv("")
        with self.assertRaisesRegex(ValueError, "header"):
            load_points(path)

    def test_rejects_header_without_data_rows(self):
        path = self.write_csv("timestamp,value\n")
        with self.assertRaisesRegex(ValueError, "at least one data row"):
            load_points(path)

    def test_rejects_incorrect_header(self):
        path = self.write_csv("time,value\n2026-01-01T00:00:00Z,10\n")
        with self.assertRaisesRegex(ValueError, "header must be exactly"):
            load_points(path)

    def test_rejects_missing_columns(self):
        path = self.write_csv("timestamp,value\n2026-01-01T00:00:00Z\n")
        with self.assertRaisesRegex(ValueError, "exactly 2 columns"):
            load_points(path)

    def test_rejects_extra_columns(self):
        path = self.write_csv(
            "timestamp,value\n2026-01-01T00:00:00Z,10,unexpected\n"
        )
        with self.assertRaisesRegex(ValueError, "exactly 2 columns"):
            load_points(path)

    def test_rejects_blank_required_fields(self):
        path = self.write_csv("timestamp,value\n2026-01-01T00:00:00Z,\n")
        with self.assertRaisesRegex(ValueError, "timestamp and value are required"):
            load_points(path)

    def test_rejects_malformed_csv_quoting(self):
        path = self.write_csv(
            'timestamp,value\n2026-01-01T00:00:00Z,"10\n'
        )
        with self.assertRaisesRegex(ValueError, "malformed CSV"):
            load_points(path)

    def test_rejects_invalid_utf8(self):
        path = self.write_bytes(b"timestamp,value\n\xff,10\n")
        with self.assertRaises(UnicodeDecodeError):
            load_points(path)


if __name__ == "__main__":
    unittest.main()
