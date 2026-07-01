#!/usr/bin/env python3
import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
import datetime as dt


REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "tools" / "gpu_monitor" / "update_gpu_usage.py"

spec = importlib.util.spec_from_file_location("update_gpu_usage", MODULE_PATH)
ug = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ug)


def mk_snapshot(hour, nodes=None, gpus=None, hourly_cost=None, estimated=False, fetch_ok=True, source="test"):
    nodes = nodes or {"H100": 1, "A100": 2, "A100_40GB": 0}
    gpus = gpus or {"H100": 8, "A100": 16, "A100_40GB": 0}
    if hourly_cost is None:
        hourly_cost = {
            "H100": nodes["H100"] * ug.NODE_HOURLY_COSTS["H100"],
            "A100": nodes["A100"] * ug.NODE_HOURLY_COSTS["A100"],
            "A100_40GB": nodes["A100_40GB"] * ug.NODE_HOURLY_COSTS["A100_40GB"],
        }
    return {
        "hour": ug.iso_utc(hour),
        "captured_at": ug.iso_utc(hour + dt.timedelta(minutes=3)),
        "source": source,
        "fetch_ok": fetch_ok,
        "estimated": estimated,
        "error": None if fetch_ok else "err",
        "jobs_total": 3,
        "jobs_tracked": 3,
        "nodes": nodes,
        "gpus": gpus,
        "hourly_cost": hourly_cost,
        "total_hourly_cost": ug.round2(sum(hourly_cost.values())),
        "projects_top": [],
    }


class TestUpdateGpuUsage(unittest.TestCase):
    # 1
    def test_01_iso_utc_formats_z(self):
        value = ug.iso_utc(dt.datetime(2026, 3, 4, 22, 48, tzinfo=dt.timezone.utc))
        self.assertTrue(value.endswith("Z"))
        self.assertIn("T22:48:00", value)

    # 2
    def test_02_parse_iso_accepts_z(self):
        parsed = ug.parse_iso("2026-03-04T22:00:00Z")
        self.assertEqual(parsed.tzinfo, dt.timezone.utc)
        self.assertEqual(parsed.hour, 22)

    # 3
    def test_03_parse_iso_accepts_naive(self):
        parsed = ug.parse_iso("2026-03-04T22:00:00")
        self.assertEqual(parsed.tzinfo, dt.timezone.utc)
        self.assertEqual(parsed.day, 4)

    # 4
    def test_04_floor_to_hour(self):
        raw = dt.datetime(2026, 3, 4, 22, 59, 31, 123, tzinfo=dt.timezone.utc)
        out = ug.floor_to_hour(raw)
        self.assertEqual(out.minute, 0)
        self.assertEqual(out.second, 0)
        self.assertEqual(out.microsecond, 0)

    # 5
    def test_05_safe_int_valid_and_invalid(self):
        self.assertEqual(ug.safe_int("14"), 14)
        self.assertEqual(ug.safe_int("bad", 7), 7)

    # 6
    def test_06_round2(self):
        self.assertEqual(ug.round2(1.235), 1.24)
        self.assertEqual(ug.round2(1.234), 1.23)

    # 7
    def test_07_normalize_gpu_type_direct(self):
        self.assertEqual(ug.normalize_gpu_type("H100"), "H100")
        self.assertEqual(ug.normalize_gpu_type("A100"), "A100")
        self.assertEqual(ug.normalize_gpu_type("A100-40GB"), "A100_40GB")

    # 8
    def test_08_normalize_gpu_type_instance(self):
        self.assertEqual(ug.normalize_gpu_type("NVIDIA_A100_80GB"), "A100")
        self.assertEqual(ug.normalize_gpu_type("p4d.24xlarge"), "A100_40GB")
        self.assertEqual(ug.normalize_gpu_type("unknown"), None)

    # 9
    def test_09_init_metric_dict(self):
        metrics = ug.init_metric_dict()
        self.assertEqual(set(metrics.keys()), set(ug.GPU_TYPES))
        self.assertTrue(all(v == 0.0 for v in metrics.values()))

    # 10
    def test_10_parse_pluto_jobs_csv_valid(self):
        output = (
            "job1,id1,proj,running,2,NVIDIA_A100_80GB,8,http://x,u1\n"
            "job2,id2,proj,running,1,NVIDIA_H100,8,http://y,u2\n"
        )
        jobs = ug.parse_pluto_jobs_csv(output)
        self.assertEqual(len(jobs), 2)
        self.assertEqual(jobs[0]["name"], "job1")
        self.assertEqual(jobs[1]["num_pods"], 1)

    # 11
    def test_11_parse_pluto_jobs_csv_invalid_lines(self):
        output = "bad,line\n\njob1,id1,proj,running,2,NVIDIA_A100_80GB,8,http://x,u1\n"
        jobs = ug.parse_pluto_jobs_csv(output)
        self.assertEqual(len(jobs), 1)

    # 12
    def test_12_summarize_jobs_counts(self):
        jobs = [
            {"name": "a", "project": "p1", "accelerator_type": "NVIDIA_H100", "num_pods": 1, "gpus_per_pod": 8},
            {"name": "b", "project": "p1", "accelerator_type": "NVIDIA_A100_80GB", "num_pods": 2, "gpus_per_pod": 8},
        ]
        snap = ug.summarize_jobs_to_snapshot(
            jobs=jobs,
            snapshot_hour=dt.datetime(2026, 3, 4, 22, tzinfo=dt.timezone.utc),
            captured_at=dt.datetime(2026, 3, 4, 22, 3, tzinfo=dt.timezone.utc),
            source="pluto",
        )
        self.assertEqual(snap["nodes"]["H100"], 1)
        self.assertEqual(snap["nodes"]["A100"], 2)
        self.assertEqual(snap["gpus"]["A100"], 16)
        self.assertGreater(snap["total_hourly_cost"], 0)

    # 13
    def test_13_summarize_jobs_ignores_unknown_gpu(self):
        jobs = [{"project": "p", "accelerator_type": "CPU_ONLY", "num_pods": 10, "gpus_per_pod": 8}]
        snap = ug.summarize_jobs_to_snapshot(
            jobs=jobs,
            snapshot_hour=dt.datetime(2026, 3, 4, 22, tzinfo=dt.timezone.utc),
            captured_at=dt.datetime(2026, 3, 4, 22, 3, tzinfo=dt.timezone.utc),
            source="pluto",
        )
        self.assertEqual(sum(snap["nodes"].values()), 0)
        self.assertEqual(sum(snap["gpus"].values()), 0)

    # 14
    def test_14_summarize_flags(self):
        snap = ug.summarize_jobs_to_snapshot(
            jobs=[],
            snapshot_hour=dt.datetime(2026, 3, 4, 22, tzinfo=dt.timezone.utc),
            captured_at=dt.datetime(2026, 3, 4, 22, 3, tzinfo=dt.timezone.utc),
            source="pluto",
            error_message="x",
            estimated=True,
        )
        self.assertFalse(snap["fetch_ok"])
        self.assertTrue(snap["estimated"])
        self.assertEqual(snap["error"], "x")

    # 15
    def test_15_estimated_from_previous(self):
        prev = mk_snapshot(dt.datetime(2026, 3, 4, 21, tzinfo=dt.timezone.utc))
        est = ug.build_estimated_snapshot_from_previous(
            previous_snapshot=prev,
            snapshot_hour=dt.datetime(2026, 3, 4, 22, tzinfo=dt.timezone.utc),
            captured_at=dt.datetime(2026, 3, 4, 22, 5, tzinfo=dt.timezone.utc),
            error_message="err",
            source="estimated_fetch_failure",
        )
        self.assertEqual(est["nodes"], prev["nodes"])
        self.assertEqual(est["source"], "estimated_fetch_failure")
        self.assertTrue(est["estimated"])

    # 16
    def test_16_estimated_without_previous(self):
        est = ug.build_estimated_snapshot_from_previous(
            previous_snapshot=None,
            snapshot_hour=dt.datetime(2026, 3, 4, 22, tzinfo=dt.timezone.utc),
            captured_at=dt.datetime(2026, 3, 4, 22, 5, tzinfo=dt.timezone.utc),
            error_message="err",
        )
        self.assertEqual(est["total_hourly_cost"], 0.0)
        self.assertTrue(est["estimated"])

    # 17
    def test_17_gap_fill_no_previous(self):
        out = ug.build_gap_fill_snapshots(
            latest_existing_snapshot=None,
            target_hour=dt.datetime(2026, 3, 4, 22, tzinfo=dt.timezone.utc),
            generated_at=dt.datetime(2026, 3, 4, 22, 5, tzinfo=dt.timezone.utc),
            backfill_max_hours=72,
        )
        self.assertEqual(out, [])

    # 18
    def test_18_gap_fill_no_gap(self):
        latest = mk_snapshot(dt.datetime(2026, 3, 4, 21, tzinfo=dt.timezone.utc))
        out = ug.build_gap_fill_snapshots(
            latest_existing_snapshot=latest,
            target_hour=dt.datetime(2026, 3, 4, 22, tzinfo=dt.timezone.utc),
            generated_at=dt.datetime(2026, 3, 4, 22, 5, tzinfo=dt.timezone.utc),
            backfill_max_hours=72,
        )
        self.assertEqual(len(out), 0)

    # 19
    def test_19_gap_fill_generates_hours(self):
        latest = mk_snapshot(dt.datetime(2026, 3, 4, 18, tzinfo=dt.timezone.utc))
        out = ug.build_gap_fill_snapshots(
            latest_existing_snapshot=latest,
            target_hour=dt.datetime(2026, 3, 4, 22, tzinfo=dt.timezone.utc),
            generated_at=dt.datetime(2026, 3, 4, 22, 5, tzinfo=dt.timezone.utc),
            backfill_max_hours=72,
        )
        self.assertEqual(len(out), 3)
        self.assertTrue(all(s["source"] == "estimated_gap_fill" for s in out))

    # 20
    def test_20_gap_fill_respects_cap(self):
        latest = mk_snapshot(dt.datetime(2026, 3, 1, 0, tzinfo=dt.timezone.utc))
        out = ug.build_gap_fill_snapshots(
            latest_existing_snapshot=latest,
            target_hour=dt.datetime(2026, 3, 4, 22, tzinfo=dt.timezone.utc),
            generated_at=dt.datetime(2026, 3, 4, 22, 5, tzinfo=dt.timezone.utc),
            backfill_max_hours=5,
        )
        self.assertEqual(len(out), 5)

    # 21
    def test_21_merge_overrides_and_limits(self):
        base = [
            mk_snapshot(dt.datetime(2026, 3, 4, 20, tzinfo=dt.timezone.utc)),
            mk_snapshot(dt.datetime(2026, 3, 4, 21, tzinfo=dt.timezone.utc)),
        ]
        newer = [
            mk_snapshot(dt.datetime(2026, 3, 4, 21, tzinfo=dt.timezone.utc), source="new"),
            mk_snapshot(dt.datetime(2026, 3, 4, 22, tzinfo=dt.timezone.utc)),
        ]
        merged = ug.merge_snapshots_by_hour(base, newer, max_hours=2)
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0]["hour"], ug.iso_utc(dt.datetime(2026, 3, 4, 21, tzinfo=dt.timezone.utc)))
        self.assertEqual(merged[0]["source"], "new")

    # 22
    def test_22_aggregate_snapshot_list_empty(self):
        agg = ug.aggregate_snapshot_list([])
        self.assertEqual(agg["hours"], 0)
        self.assertEqual(agg["total_cost"], 0.0)

    # 23
    def test_23_aggregate_snapshot_list_non_empty(self):
        snaps = [
            mk_snapshot(dt.datetime(2026, 3, 4, 20, tzinfo=dt.timezone.utc), estimated=False, fetch_ok=True),
            mk_snapshot(dt.datetime(2026, 3, 4, 21, tzinfo=dt.timezone.utc), estimated=True, fetch_ok=False),
        ]
        agg = ug.aggregate_snapshot_list(snaps)
        self.assertEqual(agg["hours"], 2)
        self.assertEqual(agg["observed_hours"], 1)
        self.assertEqual(agg["estimated_hours"], 1)
        self.assertGreater(agg["total_gpu_hours"], 0)

    # 24
    def test_24_aggregate_by_period_daily(self):
        snaps = [
            mk_snapshot(dt.datetime(2026, 3, 4, 20, tzinfo=dt.timezone.utc)),
            mk_snapshot(dt.datetime(2026, 3, 4, 21, tzinfo=dt.timezone.utc)),
            mk_snapshot(dt.datetime(2026, 3, 5, 0, tzinfo=dt.timezone.utc)),
        ]
        daily = ug.aggregate_by_period(snaps, "daily")
        self.assertEqual(len(daily), 2)
        self.assertEqual(daily[0]["hours"], 2)
        self.assertEqual(daily[1]["hours"], 1)

    # 25
    def test_25_aggregate_by_period_weekly_and_monthly(self):
        snaps = [
            mk_snapshot(dt.datetime(2026, 3, 1, 10, tzinfo=dt.timezone.utc)),
            mk_snapshot(dt.datetime(2026, 3, 8, 10, tzinfo=dt.timezone.utc)),
            mk_snapshot(dt.datetime(2026, 4, 1, 10, tzinfo=dt.timezone.utc)),
        ]
        weekly = ug.aggregate_by_period(snaps, "weekly")
        monthly = ug.aggregate_by_period(snaps, "monthly")
        self.assertGreaterEqual(len(weekly), 2)
        self.assertEqual(len(monthly), 2)

    # 26
    def test_26_compute_rolling_window(self):
        start = dt.datetime(2026, 3, 1, 0, tzinfo=dt.timezone.utc)
        snaps = [mk_snapshot(start + dt.timedelta(hours=i)) for i in range(10)]
        roll = ug.compute_rolling_window(snaps, trailing_hours=4)
        self.assertEqual(roll["hours"], 4)

    # 27
    def test_27_build_aggregates_document_empty(self):
        doc = ug.build_aggregates_document(
            snapshots=[],
            generated_at=dt.datetime(2026, 3, 4, 22, tzinfo=dt.timezone.utc),
            stale_after_hours=2,
        )
        self.assertEqual(doc["snapshot_count"], 0)
        self.assertTrue(doc["is_stale"])

    # 28
    def test_28_build_aggregates_document_with_data(self):
        snaps = [mk_snapshot(dt.datetime(2026, 3, 4, 20, tzinfo=dt.timezone.utc))]
        doc = ug.build_aggregates_document(
            snapshots=snaps,
            generated_at=dt.datetime(2026, 3, 4, 21, 30, tzinfo=dt.timezone.utc),
            stale_after_hours=2,
        )
        self.assertEqual(doc["snapshot_count"], 1)
        self.assertFalse(doc["is_stale"])
        self.assertGreater(doc["kpis"]["current_hourly_cost"], 0)

    # 29
    def test_29_build_health_document(self):
        agg = ug.build_aggregates_document(
            snapshots=[mk_snapshot(dt.datetime(2026, 3, 4, 20, tzinfo=dt.timezone.utc))],
            generated_at=dt.datetime(2026, 3, 4, 21, tzinfo=dt.timezone.utc),
            stale_after_hours=2,
        )
        health = ug.build_health_document(
            generated_at=dt.datetime(2026, 3, 4, 21, tzinfo=dt.timezone.utc),
            status="ok",
            message=None,
            aggregates=agg,
        )
        self.assertEqual(health["status"], "ok")
        self.assertEqual(health["snapshot_count"], 1)
        self.assertIn("coverage_pct", health["quality"])

    # 30
    def test_30_main_end_to_end_with_sqlite_source(self):
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            sqlite_path = td_path / "gpu_usage.db"
            out_dir = td_path / "out"

            with sqlite3.connect(sqlite_path) as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    CREATE TABLE current_usage (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp TEXT NOT NULL,
                        gpu_type TEXT NOT NULL,
                        num_gpus INTEGER NOT NULL,
                        num_nodes INTEGER NOT NULL,
                        num_jobs INTEGER NOT NULL
                    )
                    """
                )
                ts = "2026-03-04T22:00:00"
                cur.execute(
                    "INSERT INTO current_usage (timestamp, gpu_type, num_gpus, num_nodes, num_jobs) VALUES (?, ?, ?, ?, ?)",
                    (ts, "H100", 32, 4, 1),
                )
                cur.execute(
                    "INSERT INTO current_usage (timestamp, gpu_type, num_gpus, num_nodes, num_jobs) VALUES (?, ?, ?, ?, ?)",
                    (ts, "A100", 144, 18, 4),
                )
                conn.commit()

            cmd = [
                sys.executable,
                str(MODULE_PATH),
                "--output-dir",
                str(out_dir),
                "--source",
                "sqlite",
                "--sqlite-path",
                str(sqlite_path),
                "--allow-fetch-failure",
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, msg=result.stderr)

            snapshots = json.loads((out_dir / "snapshots.json").read_text(encoding="utf-8"))
            aggregates = json.loads((out_dir / "aggregates.json").read_text(encoding="utf-8"))
            health = json.loads((out_dir / "health.json").read_text(encoding="utf-8"))

            self.assertEqual(snapshots["snapshot_count"], 1)
            self.assertEqual(aggregates["snapshot_count"], 1)
            self.assertEqual(health["status"], "ok")
            self.assertEqual(aggregates["latest"]["source"], "sqlite_live")
            self.assertGreater(aggregates["kpis"]["current_hourly_cost"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
