import tempfile
import unittest
from pathlib import Path

from validate_replay import load_points, replay


class TimeSeriesLabTests(unittest.TestCase):
    def write_csv(self, content: str) -> Path:
        temp = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".csv", delete=False)
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
        with self.assertRaisesRegex(ValueError, "timezone"):
            load_points(path)


if __name__ == "__main__":
    unittest.main()
