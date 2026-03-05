#!/usr/bin/env python3
"""
Hourly GPU usage snapshot updater for the static GitHub Pages dashboard.

This script writes three JSON files:
- gpu-cluster-monitor/data/snapshots.json
- gpu-cluster-monitor/data/aggregates.json
- gpu-cluster-monitor/data/health.json

Design goals:
- Keep one canonical snapshot per UTC hour.
- Preserve long history with bounded retention.
- Compute reliable daily/weekly/monthly accumulators.
- Continue operating even when live data fetch fails (optional).
"""

from __future__ import annotations

import argparse
import copy
import csv
import datetime as dt
import json
import shlex
import sqlite3
import subprocess
import tempfile
import time
from collections import defaultdict
from io import StringIO
from pathlib import Path
from typing import Any

GPU_TYPES = ("H100", "A100", "A100_40GB")
GPU_INSTANCE_TYPES = {
    "H100": "p5.48xlarge",
    "A100": "p4de.24xlarge",
    "A100_40GB": "p4d.24xlarge",
}
GPUS_PER_NODE = 8
NODE_HOURLY_COSTS = {
    # Market-price reference model:
    # AWS EC2 public price list, us-east-1, Linux, Shared tenancy, CapacityStatus=Used, OnDemand.
    # Source publication used to pin these rates: 2026-03-04T22:42:40Z.
    "H100": 55.04,       # p5.48xlarge
    "A100": 27.44705,    # p4de.24xlarge
    "A100_40GB": 21.957642,  # p4d.24xlarge
}
PRICING_MODEL = {
    "name": "AWS EC2 On-Demand Linux Shared (US East / N. Virginia)",
    "market_price_definition": (
        "Per-node hourly rate from AWS EC2 public price list "
        "(OnDemand + OperatingSystem=Linux + Tenancy=Shared + CapacityStatus=Used + Location=US East (N. Virginia))."
    ),
    "currency": "USD",
    "reference_publication_utc": "2026-03-04T22:42:40Z",
    "source_links": [
        {
            "label": "AWS EC2 On-Demand Pricing",
            "url": "https://aws.amazon.com/ec2/pricing/on-demand/",
        },
        {
            "label": "AWS EC2 Public Price List (AmazonEC2 us-east-1 CSV)",
            "url": "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-1/index.csv",
        },
        {
            "label": "AWS P5 Instance Family (H100)",
            "url": "https://aws.amazon.com/ec2/instance-types/p5/",
        },
        {
            "label": "AWS P4 Instance Family (A100)",
            "url": "https://aws.amazon.com/ec2/instance-types/p4/",
        },
    ],
}

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_OUTPUT_DIR = REPO_ROOT / "gpu-cluster-monitor" / "data"
DEFAULT_SNAPSHOTS_PATH = DEFAULT_OUTPUT_DIR / "snapshots.json"
DEFAULT_AGGREGATES_PATH = DEFAULT_OUTPUT_DIR / "aggregates.json"
DEFAULT_HEALTH_PATH = DEFAULT_OUTPUT_DIR / "health.json"


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso_utc(ts: dt.datetime) -> str:
    return ts.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso(value: str) -> dt.datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    parsed = dt.datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def floor_to_hour(ts: dt.datetime) -> dt.datetime:
    ts = ts.astimezone(dt.timezone.utc)
    return ts.replace(minute=0, second=0, microsecond=0)


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return default


def round2(value: float) -> float:
    return float(f"{value:.2f}")


def normalize_gpu_type(raw: str) -> str | None:
    if not raw:
        return None
    text = raw.upper().strip()

    if text == "H100":
        return "H100"
    if text in {"A100", "A100_80GB", "A100-80GB"}:
        return "A100"
    if text in {"A100_40GB", "A100-40GB"}:
        return "A100_40GB"

    if "H100" in text or "P5.48XLARGE" in text:
        return "H100"
    if "A100_80GB" in text or "A100 80" in text or "P4DE.24XLARGE" in text:
        return "A100"
    if "A100_40GB" in text or "A100 40" in text or "P4D.24XLARGE" in text:
        return "A100_40GB"
    return None


def init_metric_dict() -> dict[str, float]:
    return {gpu_type: 0.0 for gpu_type in GPU_TYPES}


def read_json_or_default(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=str(path.parent)) as tmp:
        json.dump(payload, tmp, indent=2, ensure_ascii=False, sort_keys=False)
        tmp.flush()
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)


def parse_pluto_jobs_csv(output: str) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    reader = csv.reader(StringIO(output))

    for row in reader:
        if not row or len(row) < 9:
            continue
        jobs.append(
            {
                "name": row[0].strip(),
                "job_id": row[1].strip(),
                "project": row[2].strip(),
                "status": row[3].strip(),
                "num_pods": safe_int(row[4]),
                "accelerator_type": row[5].strip(),
                "gpus_per_pod": safe_int(row[6]),
                "url": row[7].strip(),
                "owner": row[8].strip(),
            }
        )
    return jobs


def fetch_running_jobs_from_pluto(pluto_cmd: str, timeout_seconds: int = 90) -> list[dict[str, Any]]:
    cmd = shlex.split(pluto_cmd) + ["job", "list", "--status", "running"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_seconds)
    if result.returncode != 0:
        stderr = result.stderr.strip()
        raise RuntimeError(f"Pluto command failed: {' '.join(cmd)} | {stderr}")
    return parse_pluto_jobs_csv(result.stdout)


def summarize_jobs_to_snapshot(
    jobs: list[dict[str, Any]],
    snapshot_hour: dt.datetime,
    captured_at: dt.datetime,
    source: str,
    error_message: str | None = None,
    estimated: bool = False,
) -> dict[str, Any]:
    nodes = {gpu_type: 0 for gpu_type in GPU_TYPES}
    gpus = {gpu_type: 0 for gpu_type in GPU_TYPES}
    hourly_cost = {gpu_type: 0.0 for gpu_type in GPU_TYPES}
    project_rollup: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"project": "", "jobs": 0, "nodes": 0, "gpus": 0, "hourly_cost": 0.0}
    )

    jobs_total = len(jobs)
    jobs_tracked = 0

    for job in jobs:
        gpu_type = normalize_gpu_type(job.get("accelerator_type", ""))
        if gpu_type is None:
            continue
        jobs_tracked += 1
        num_pods = safe_int(job.get("num_pods", 0))
        gpus_per_pod = safe_int(job.get("gpus_per_pod", 0))
        total_gpus = max(num_pods * gpus_per_pod, 0)

        nodes[gpu_type] += num_pods
        gpus[gpu_type] += total_gpus

        project_name = job.get("project") or "unknown"
        rollup = project_rollup[project_name]
        rollup["project"] = project_name
        rollup["jobs"] += 1
        rollup["nodes"] += num_pods
        rollup["gpus"] += total_gpus
        rollup["hourly_cost"] = round2(rollup["hourly_cost"] + (num_pods * NODE_HOURLY_COSTS[gpu_type]))

    total_hourly_cost = 0.0
    for gpu_type in GPU_TYPES:
        hourly_cost[gpu_type] = round2(nodes[gpu_type] * NODE_HOURLY_COSTS[gpu_type])
        total_hourly_cost += hourly_cost[gpu_type]

    projects_top = sorted(
        (dict(v) for v in project_rollup.values()),
        key=lambda x: (x["hourly_cost"], x["jobs"], x["nodes"], x["gpus"]),
        reverse=True,
    )[:20]

    return {
        "hour": iso_utc(snapshot_hour),
        "captured_at": iso_utc(captured_at),
        "source": source,
        "fetch_ok": error_message is None,
        "estimated": estimated,
        "error": error_message,
        "jobs_total": jobs_total,
        "jobs_tracked": jobs_tracked,
        "nodes": nodes,
        "gpus": gpus,
        "hourly_cost": hourly_cost,
        "total_hourly_cost": round2(total_hourly_cost),
        "projects_top": projects_top,
    }


def fetch_current_snapshot_from_sqlite(sqlite_path: Path, snapshot_hour: dt.datetime, captured_at: dt.datetime) -> dict[str, Any]:
    if not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite path does not exist: {sqlite_path}")

    nodes = {gpu_type: 0 for gpu_type in GPU_TYPES}
    gpus = {gpu_type: 0 for gpu_type in GPU_TYPES}
    hourly_cost = {gpu_type: 0.0 for gpu_type in GPU_TYPES}
    jobs_total = 0
    jobs_tracked = 0

    with sqlite3.connect(sqlite_path) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT MAX(timestamp) AS latest_ts FROM current_usage")
        latest_row = cursor.fetchone()
        latest_ts = latest_row["latest_ts"] if latest_row else None
        if not latest_ts:
            raise RuntimeError("No rows in current_usage table")

        cursor.execute(
            """
            SELECT gpu_type, num_gpus, num_nodes, num_jobs
            FROM current_usage
            WHERE timestamp = ?
            """,
            (latest_ts,),
        )
        rows = cursor.fetchall()
        if not rows:
            raise RuntimeError("No current_usage rows for latest timestamp")

        for row in rows:
            gpu_type = normalize_gpu_type(str(row["gpu_type"]))
            if gpu_type is None:
                continue
            num_nodes = safe_int(row["num_nodes"])
            num_gpus = safe_int(row["num_gpus"])
            num_jobs = safe_int(row["num_jobs"])

            nodes[gpu_type] += num_nodes
            gpus[gpu_type] += num_gpus
            jobs_total += num_jobs
            jobs_tracked += num_jobs

    total_hourly_cost = 0.0
    for gpu_type in GPU_TYPES:
        hourly_cost[gpu_type] = round2(nodes[gpu_type] * NODE_HOURLY_COSTS[gpu_type])
        total_hourly_cost += hourly_cost[gpu_type]

    return {
        "hour": iso_utc(snapshot_hour),
        "captured_at": iso_utc(captured_at),
        "source": "sqlite_live",
        "fetch_ok": True,
        "estimated": False,
        "error": None,
        "jobs_total": jobs_total,
        "jobs_tracked": jobs_tracked,
        "nodes": nodes,
        "gpus": gpus,
        "hourly_cost": hourly_cost,
        "total_hourly_cost": round2(total_hourly_cost),
        "projects_top": [],
    }


def build_estimated_snapshot_from_previous(
    previous_snapshot: dict[str, Any] | None,
    snapshot_hour: dt.datetime,
    captured_at: dt.datetime,
    error_message: str,
    source: str = "estimated_from_previous",
) -> dict[str, Any]:
    if previous_snapshot:
        snapshot = copy.deepcopy(previous_snapshot)
        snapshot["hour"] = iso_utc(snapshot_hour)
        snapshot["captured_at"] = iso_utc(captured_at)
        snapshot["source"] = source
        snapshot["fetch_ok"] = False
        snapshot["estimated"] = True
        snapshot["error"] = error_message
        snapshot["based_on_hour"] = previous_snapshot.get("hour")
        return snapshot

    empty_metrics = {gpu_type: 0 for gpu_type in GPU_TYPES}
    empty_costs = {gpu_type: 0.0 for gpu_type in GPU_TYPES}
    return {
        "hour": iso_utc(snapshot_hour),
        "captured_at": iso_utc(captured_at),
        "source": "estimated_empty",
        "fetch_ok": False,
        "estimated": True,
        "error": error_message,
        "jobs_total": 0,
        "jobs_tracked": 0,
        "nodes": empty_metrics,
        "gpus": empty_metrics,
        "hourly_cost": empty_costs,
        "total_hourly_cost": 0.0,
        "projects_top": [],
    }


def build_gap_fill_snapshots(
    latest_existing_snapshot: dict[str, Any] | None,
    target_hour: dt.datetime,
    generated_at: dt.datetime,
    backfill_max_hours: int,
) -> list[dict[str, Any]]:
    """
    Fill missing per-hour snapshots between latest existing and target hour.
    Uses strict last-known-state carry-forward to keep an uninterrupted hourly series.
    """
    if latest_existing_snapshot is None:
        return []

    latest_hour = parse_iso(latest_existing_snapshot["hour"])
    first_missing_hour = latest_hour + dt.timedelta(hours=1)
    last_missing_hour = target_hour - dt.timedelta(hours=1)

    if first_missing_hour > last_missing_hour:
        return []

    missing_hours = int((last_missing_hour - first_missing_hour).total_seconds() // 3600) + 1
    if backfill_max_hours > 0 and missing_hours > backfill_max_hours:
        first_missing_hour = last_missing_hour - dt.timedelta(hours=backfill_max_hours - 1)

    snapshots: list[dict[str, Any]] = []
    previous = latest_existing_snapshot
    current_hour = first_missing_hour
    while current_hour <= last_missing_hour:
        estimated = build_estimated_snapshot_from_previous(
            previous_snapshot=previous,
            snapshot_hour=current_hour,
            captured_at=generated_at,
            error_message="Gap-filled from previous hour due missing data collection run",
            source="estimated_gap_fill",
        )
        snapshots.append(estimated)
        previous = estimated
        current_hour += dt.timedelta(hours=1)
    return snapshots


def load_seed_snapshots_from_sqlite(sqlite_path: Path) -> list[dict[str, Any]]:
    if not sqlite_path.exists():
        return []

    rows_by_hour: dict[str, dict[str, Any]] = {}

    with sqlite3.connect(sqlite_path) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT hour, gpu_type, num_gpus, num_nodes, num_jobs, hourly_cost
            FROM usage_history
            ORDER BY hour ASC
            """
        )
        for row in cursor.fetchall():
            raw_hour = row["hour"]
            if not raw_hour:
                continue
            hour_dt = floor_to_hour(parse_iso(str(raw_hour)))
            hour_key = iso_utc(hour_dt)

            if hour_key not in rows_by_hour:
                rows_by_hour[hour_key] = {
                    "hour": hour_key,
                    "captured_at": hour_key,
                    "source": "seed_sqlite_history",
                    "fetch_ok": True,
                    "estimated": False,
                    "error": None,
                    "jobs_total": 0,
                    "jobs_tracked": 0,
                    "nodes": {gpu_type: 0 for gpu_type in GPU_TYPES},
                    "gpus": {gpu_type: 0 for gpu_type in GPU_TYPES},
                    "hourly_cost": {gpu_type: 0.0 for gpu_type in GPU_TYPES},
                    "total_hourly_cost": 0.0,
                    "projects_top": [],
                }

            gpu_type = normalize_gpu_type(str(row["gpu_type"]))
            if gpu_type is None:
                continue

            num_nodes = safe_int(row["num_nodes"])
            num_gpus = safe_int(row["num_gpus"])
            num_jobs = safe_int(row["num_jobs"])
            # Recompute from nodes using the current pricing model so historical
            # data is consistent even if upstream DB used older rates.
            row_hourly_cost = num_nodes * NODE_HOURLY_COSTS[gpu_type]

            snapshot = rows_by_hour[hour_key]
            snapshot["nodes"][gpu_type] += num_nodes
            snapshot["gpus"][gpu_type] += num_gpus
            snapshot["hourly_cost"][gpu_type] = round2(snapshot["hourly_cost"][gpu_type] + row_hourly_cost)
            snapshot["jobs_total"] += num_jobs
            snapshot["jobs_tracked"] += num_jobs

        # Include the latest current_usage timestamp if it is newer than usage_history.
        cursor.execute(
            """
            SELECT timestamp, gpu_type, num_gpus, num_nodes, num_jobs
            FROM current_usage
            """
        )
        current_rows = cursor.fetchall()
        if current_rows:
            first_ts = current_rows[0]["timestamp"]
            if first_ts:
                current_hour = floor_to_hour(parse_iso(str(first_ts)))
                current_hour_key = iso_utc(current_hour)
                if current_hour_key not in rows_by_hour:
                    rows_by_hour[current_hour_key] = {
                        "hour": current_hour_key,
                        "captured_at": current_hour_key,
                        "source": "seed_sqlite_current_usage",
                        "fetch_ok": True,
                        "estimated": False,
                        "error": None,
                        "jobs_total": 0,
                        "jobs_tracked": 0,
                        "nodes": {gpu_type: 0 for gpu_type in GPU_TYPES},
                        "gpus": {gpu_type: 0 for gpu_type in GPU_TYPES},
                        "hourly_cost": {gpu_type: 0.0 for gpu_type in GPU_TYPES},
                        "total_hourly_cost": 0.0,
                        "projects_top": [],
                    }
                snapshot = rows_by_hour[current_hour_key]
                for row in current_rows:
                    gpu_type = normalize_gpu_type(str(row["gpu_type"]))
                    if gpu_type is None:
                        continue
                    num_nodes = safe_int(row["num_nodes"])
                    num_gpus = safe_int(row["num_gpus"])
                    num_jobs = safe_int(row["num_jobs"])
                    snapshot["nodes"][gpu_type] += num_nodes
                    snapshot["gpus"][gpu_type] += num_gpus
                    snapshot["hourly_cost"][gpu_type] = round2(
                        snapshot["hourly_cost"][gpu_type] + (num_nodes * NODE_HOURLY_COSTS[gpu_type])
                    )
                    snapshot["jobs_total"] += num_jobs
                    snapshot["jobs_tracked"] += num_jobs

    snapshots = sorted(rows_by_hour.values(), key=lambda x: x["hour"])
    for snapshot in snapshots:
        snapshot["total_hourly_cost"] = round2(sum(float(snapshot["hourly_cost"][gpu_type]) for gpu_type in GPU_TYPES))
    return snapshots


def merge_snapshots_by_hour(
    existing_snapshots: list[dict[str, Any]],
    new_snapshots: list[dict[str, Any]],
    max_hours: int,
) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for snapshot in existing_snapshots:
        merged[snapshot["hour"]] = snapshot
    for snapshot in new_snapshots:
        merged[snapshot["hour"]] = snapshot

    ordered = sorted(merged.values(), key=lambda x: x["hour"])
    if max_hours > 0 and len(ordered) > max_hours:
        ordered = ordered[-max_hours:]
    return ordered


def aggregate_snapshot_list(snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    node_hours = init_metric_dict()
    gpu_hours = init_metric_dict()
    cost_by_type = init_metric_dict()
    observed_hours = 0
    estimated_hours = 0

    for snapshot in snapshots:
        if snapshot.get("estimated"):
            estimated_hours += 1
        elif snapshot.get("fetch_ok"):
            observed_hours += 1

        for gpu_type in GPU_TYPES:
            node_hours[gpu_type] += float(snapshot.get("nodes", {}).get(gpu_type, 0))
            gpu_hours[gpu_type] += float(snapshot.get("gpus", {}).get(gpu_type, 0))
            cost_by_type[gpu_type] += float(snapshot.get("hourly_cost", {}).get(gpu_type, 0.0))

    hours = len(snapshots)
    total_node_hours = sum(node_hours.values())
    total_gpu_hours = sum(gpu_hours.values())
    total_cost = sum(cost_by_type.values())

    avg_nodes = {
        gpu_type: round2(node_hours[gpu_type] / hours) if hours else 0.0
        for gpu_type in GPU_TYPES
    }
    avg_gpus = {
        gpu_type: round2(gpu_hours[gpu_type] / hours) if hours else 0.0
        for gpu_type in GPU_TYPES
    }

    return {
        "hours": hours,
        "observed_hours": observed_hours,
        "estimated_hours": estimated_hours,
        "node_hours": {gpu_type: round2(node_hours[gpu_type]) for gpu_type in GPU_TYPES},
        "gpu_hours": {gpu_type: round2(gpu_hours[gpu_type]) for gpu_type in GPU_TYPES},
        "cost_by_type": {gpu_type: round2(cost_by_type[gpu_type]) for gpu_type in GPU_TYPES},
        "total_node_hours": round2(total_node_hours),
        "total_gpu_hours": round2(total_gpu_hours),
        "total_cost": round2(total_cost),
        "avg_nodes": avg_nodes,
        "avg_gpus": avg_gpus,
    }


def aggregate_by_period(snapshots: list[dict[str, Any]], granularity: str) -> list[dict[str, Any]]:
    if granularity not in {"daily", "weekly", "monthly"}:
        raise ValueError(f"Unsupported granularity: {granularity}")

    buckets: dict[str, dict[str, Any]] = {}

    for snapshot in snapshots:
        hour_dt = parse_iso(snapshot["hour"])
        if granularity == "daily":
            key = hour_dt.strftime("%Y-%m-%d")
        elif granularity == "weekly":
            iso = hour_dt.isocalendar()
            key = f"{iso.year}-W{iso.week:02d}"
        else:
            key = hour_dt.strftime("%Y-%m")

        if key not in buckets:
            buckets[key] = {
                "period": key,
                "start_hour": snapshot["hour"],
                "end_hour": snapshot["hour"],
                "hours": 0,
                "observed_hours": 0,
                "estimated_hours": 0,
                "node_hours": {gpu_type: 0.0 for gpu_type in GPU_TYPES},
                "gpu_hours": {gpu_type: 0.0 for gpu_type in GPU_TYPES},
                "cost_by_type": {gpu_type: 0.0 for gpu_type in GPU_TYPES},
                "total_cost": 0.0,
            }

        bucket = buckets[key]
        bucket["hours"] += 1
        bucket["end_hour"] = snapshot["hour"]
        if snapshot.get("estimated"):
            bucket["estimated_hours"] += 1
        elif snapshot.get("fetch_ok"):
            bucket["observed_hours"] += 1

        for gpu_type in GPU_TYPES:
            bucket["node_hours"][gpu_type] += float(snapshot.get("nodes", {}).get(gpu_type, 0))
            bucket["gpu_hours"][gpu_type] += float(snapshot.get("gpus", {}).get(gpu_type, 0))
            bucket["cost_by_type"][gpu_type] += float(snapshot.get("hourly_cost", {}).get(gpu_type, 0.0))
            bucket["total_cost"] += float(snapshot.get("hourly_cost", {}).get(gpu_type, 0.0))

    ordered = sorted(buckets.values(), key=lambda x: x["start_hour"])
    for bucket in ordered:
        for gpu_type in GPU_TYPES:
            bucket["node_hours"][gpu_type] = round2(bucket["node_hours"][gpu_type])
            bucket["gpu_hours"][gpu_type] = round2(bucket["gpu_hours"][gpu_type])
            bucket["cost_by_type"][gpu_type] = round2(bucket["cost_by_type"][gpu_type])
        bucket["total_node_hours"] = round2(sum(bucket["node_hours"].values()))
        bucket["total_gpu_hours"] = round2(sum(bucket["gpu_hours"].values()))
        bucket["total_cost"] = round2(bucket["total_cost"])
        if bucket["hours"] > 0:
            bucket["avg_nodes"] = {
                gpu_type: round2(bucket["node_hours"][gpu_type] / bucket["hours"])
                for gpu_type in GPU_TYPES
            }
            bucket["avg_gpus"] = {
                gpu_type: round2(bucket["gpu_hours"][gpu_type] / bucket["hours"])
                for gpu_type in GPU_TYPES
            }
        else:
            bucket["avg_nodes"] = {gpu_type: 0.0 for gpu_type in GPU_TYPES}
            bucket["avg_gpus"] = {gpu_type: 0.0 for gpu_type in GPU_TYPES}
    return ordered


def compute_rolling_window(snapshots: list[dict[str, Any]], trailing_hours: int) -> dict[str, Any]:
    if not snapshots:
        return aggregate_snapshot_list([])
    latest_hour = parse_iso(snapshots[-1]["hour"])
    cutoff = latest_hour - dt.timedelta(hours=max(trailing_hours - 1, 0))
    window = [snapshot for snapshot in snapshots if parse_iso(snapshot["hour"]) >= cutoff]
    return aggregate_snapshot_list(window)


def build_aggregates_document(
    snapshots: list[dict[str, Any]],
    generated_at: dt.datetime,
    stale_after_hours: int,
) -> dict[str, Any]:
    pricing_instances = {
        gpu_type: {
            "instance_type": GPU_INSTANCE_TYPES[gpu_type],
            "gpus_per_node": GPUS_PER_NODE,
            "node_hourly_usd": round2(NODE_HOURLY_COSTS[gpu_type]),
            "gpu_hourly_usd": round2(NODE_HOURLY_COSTS[gpu_type] / GPUS_PER_NODE),
        }
        for gpu_type in GPU_TYPES
    }
    pricing_payload = {
        **PRICING_MODEL,
        "instances": pricing_instances,
    }

    if not snapshots:
        return {
            "generated_at": iso_utc(generated_at),
            "version": 1,
            "snapshot_count": 0,
            "is_stale": True,
            "stale_threshold_hours": stale_after_hours,
            "latest": None,
            "kpis": {},
            "quality": {
                "observed_hours": 0,
                "estimated_hours": 0,
                "coverage_pct": 0.0,
            },
            "rolling": {
                "24h": aggregate_snapshot_list([]),
                "7d": aggregate_snapshot_list([]),
                "30d": aggregate_snapshot_list([]),
            },
            "pricing": pricing_payload,
            "all_time": aggregate_snapshot_list([]),
            "daily": [],
            "weekly": [],
            "monthly": [],
        }

    latest = snapshots[-1]
    latest_hour = parse_iso(latest["hour"])
    age_hours = (generated_at - latest_hour).total_seconds() / 3600.0
    is_stale = age_hours > stale_after_hours

    all_time = aggregate_snapshot_list(snapshots)
    rolling_24h = compute_rolling_window(snapshots, 24)
    rolling_7d = compute_rolling_window(snapshots, 24 * 7)
    rolling_30d = compute_rolling_window(snapshots, 24 * 30)
    daily = aggregate_by_period(snapshots, "daily")
    weekly = aggregate_by_period(snapshots, "weekly")
    monthly = aggregate_by_period(snapshots, "monthly")

    current_nodes_total = sum(float(latest.get("nodes", {}).get(gpu_type, 0)) for gpu_type in GPU_TYPES)
    current_gpus_total = sum(float(latest.get("gpus", {}).get(gpu_type, 0)) for gpu_type in GPU_TYPES)

    coverage_pct = 0.0
    if all_time["hours"] > 0:
        coverage_pct = round2((all_time["observed_hours"] / all_time["hours"]) * 100.0)

    return {
        "generated_at": iso_utc(generated_at),
        "version": 1,
        "snapshot_count": len(snapshots),
        "is_stale": is_stale,
        "stale_threshold_hours": stale_after_hours,
        "latest": latest,
        "kpis": {
            "current_nodes_total": round2(current_nodes_total),
            "current_gpus_total": round2(current_gpus_total),
            "current_hourly_cost": round2(float(latest.get("total_hourly_cost", 0.0))),
            "all_time_total_cost": all_time["total_cost"],
            "all_time_total_gpu_hours": all_time["total_gpu_hours"],
            "all_time_total_node_hours": all_time["total_node_hours"],
        },
        "quality": {
            "observed_hours": all_time["observed_hours"],
            "estimated_hours": all_time["estimated_hours"],
            "coverage_pct": coverage_pct,
        },
        "rolling": {
            "24h": rolling_24h,
            "7d": rolling_7d,
            "30d": rolling_30d,
        },
        "pricing": pricing_payload,
        "all_time": all_time,
        "daily": daily,
        "weekly": weekly,
        "monthly": monthly,
    }


def build_health_document(
    generated_at: dt.datetime,
    status: str,
    message: str | None,
    aggregates: dict[str, Any],
) -> dict[str, Any]:
    latest = aggregates.get("latest")
    latest_hour = latest.get("hour") if isinstance(latest, dict) else None
    latest_captured_at = latest.get("captured_at") if isinstance(latest, dict) else None

    return {
        "generated_at": iso_utc(generated_at),
        "status": status,
        "message": message,
        "latest_hour": latest_hour,
        "latest_captured_at": latest_captured_at,
        "snapshot_count": int(aggregates.get("snapshot_count", 0)),
        "is_stale": bool(aggregates.get("is_stale", True)),
        "quality": aggregates.get("quality", {}),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update static GPU monitor JSON data files.")
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory to write snapshots.json/aggregates.json/health.json",
    )
    parser.add_argument(
        "--max-hours",
        type=int,
        default=24 * 365,
        help="Maximum number of hourly snapshots to retain.",
    )
    parser.add_argument(
        "--source",
        choices=("pluto", "sqlite"),
        default="pluto",
        help="Primary live source for the current hourly snapshot.",
    )
    parser.add_argument(
        "--pluto-cmd",
        default="python3 -m colligo.pluto.sdk.cli",
        help="Pluto CLI command prefix.",
    )
    parser.add_argument(
        "--sqlite-path",
        default="",
        help="SQLite path for --source sqlite or --seed-sqlite.",
    )
    parser.add_argument(
        "--seed-sqlite",
        default="",
        help="Seed historical snapshots from a SQLite DB (usage_history/current_usage tables).",
    )
    parser.add_argument(
        "--allow-fetch-failure",
        action="store_true",
        help="If live fetch fails, write an estimated fallback snapshot instead of exiting with error.",
    )
    parser.add_argument(
        "--stale-after-hours",
        type=int,
        default=2,
        help="Mark dashboard stale when latest hour is older than this threshold.",
    )
    parser.add_argument(
        "--backfill-max-hours",
        type=int,
        default=72,
        help="Maximum number of missing hours to auto-gap-fill from last known snapshot.",
    )
    parser.add_argument(
        "--fetch-retries",
        type=int,
        default=3,
        help="How many live fetch attempts to make before fallback.",
    )
    parser.add_argument(
        "--retry-delay-seconds",
        type=int,
        default=20,
        help="Delay between retry attempts for live fetch.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    generated_at = utc_now()
    snapshot_hour = floor_to_hour(generated_at)

    output_dir = Path(args.output_dir).resolve()
    snapshots_path = output_dir / "snapshots.json"
    aggregates_path = output_dir / "aggregates.json"
    health_path = output_dir / "health.json"

    existing_doc = read_json_or_default(snapshots_path, {"generated_at": None, "version": 1, "snapshots": []})
    existing_snapshots = existing_doc.get("snapshots", []) if isinstance(existing_doc, dict) else []
    if not isinstance(existing_snapshots, list):
        existing_snapshots = []

    status = "ok"
    status_message = None

    seed_path: Path | None = Path(args.seed_sqlite).resolve() if args.seed_sqlite else None
    if seed_path:
        seed_snapshots = load_seed_snapshots_from_sqlite(seed_path)
        if seed_snapshots:
            existing_snapshots = merge_snapshots_by_hour(existing_snapshots, seed_snapshots, args.max_hours)
            print(f"Seeded {len(seed_snapshots)} snapshots from SQLite: {seed_path}")

    latest_existing = existing_snapshots[-1] if existing_snapshots else None
    backfilled_snapshots = build_gap_fill_snapshots(
        latest_existing_snapshot=latest_existing,
        target_hour=snapshot_hour,
        generated_at=generated_at,
        backfill_max_hours=args.backfill_max_hours,
    )
    latest_for_estimation = backfilled_snapshots[-1] if backfilled_snapshots else latest_existing

    current_snapshot: dict[str, Any] | None = None
    try:
        if args.source == "pluto":
            last_exception: Exception | None = None
            jobs: list[dict[str, Any]] | None = None
            retries = max(int(args.fetch_retries), 1)
            delay_seconds = max(int(args.retry_delay_seconds), 0)

            for attempt in range(1, retries + 1):
                try:
                    jobs = fetch_running_jobs_from_pluto(args.pluto_cmd)
                    break
                except Exception as exc:
                    last_exception = exc
                    if attempt < retries:
                        print(
                            f"WARNING: Pluto fetch attempt {attempt}/{retries} failed: {exc}. "
                            f"Retrying in {delay_seconds}s..."
                        )
                        if delay_seconds > 0:
                            time.sleep(delay_seconds)
            if jobs is None:
                assert last_exception is not None
                raise last_exception
            current_snapshot = summarize_jobs_to_snapshot(
                jobs=jobs,
                snapshot_hour=snapshot_hour,
                captured_at=generated_at,
                source="pluto",
                error_message=None,
                estimated=False,
            )
        else:
            sqlite_path = Path(args.sqlite_path).resolve() if args.sqlite_path else (
                Path(args.seed_sqlite).resolve() if args.seed_sqlite else None
            )
            if sqlite_path is None:
                raise ValueError("--source sqlite requires --sqlite-path or --seed-sqlite")
            current_snapshot = fetch_current_snapshot_from_sqlite(
                sqlite_path=sqlite_path,
                snapshot_hour=snapshot_hour,
                captured_at=generated_at,
            )
    except Exception as exc:
        error_message = str(exc)
        if not args.allow_fetch_failure:
            print(f"ERROR: {error_message}")
            return 1
        status = "degraded"
        status_message = error_message
        current_snapshot = build_estimated_snapshot_from_previous(
            previous_snapshot=latest_for_estimation,
            snapshot_hour=snapshot_hour,
            captured_at=generated_at,
            error_message=error_message,
            source="estimated_fetch_failure",
        )
        print(f"WARNING: live fetch failed, wrote estimated snapshot. reason={error_message}")

    merged_snapshots = merge_snapshots_by_hour(
        existing_snapshots,
        backfilled_snapshots + [current_snapshot],
        args.max_hours,
    )

    snapshots_doc = {
        "generated_at": iso_utc(generated_at),
        "version": 1,
        "snapshot_count": len(merged_snapshots),
        "snapshots": merged_snapshots,
    }
    aggregates_doc = build_aggregates_document(
        snapshots=merged_snapshots,
        generated_at=generated_at,
        stale_after_hours=args.stale_after_hours,
    )
    health_doc = build_health_document(
        generated_at=generated_at,
        status=status,
        message=status_message,
        aggregates=aggregates_doc,
    )

    atomic_write_json(snapshots_path, snapshots_doc)
    atomic_write_json(aggregates_path, aggregates_doc)
    atomic_write_json(health_path, health_doc)

    latest = aggregates_doc.get("latest") or {}
    latest_hour = latest.get("hour")
    current_cost = aggregates_doc.get("kpis", {}).get("current_hourly_cost", 0.0)
    print(
        "Wrote GPU monitor data | "
        f"snapshots={len(merged_snapshots)} "
        f"latest_hour={latest_hour} "
        f"current_hourly_cost=${current_cost:.2f} "
        f"status={status} "
        f"gap_filled={len(backfilled_snapshots)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
