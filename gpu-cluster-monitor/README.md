# GPU Cluster Monitor (Hidden Subpage)

This dashboard is intentionally **not linked** from the homepage navigation.
Access it directly via:

- `https://xingjian-bai.github.io/gpu-cluster-monitor/`

## What It Tracks

- Hourly snapshot of active usage for `H100`, `A100`, and `A100-40GB`
- Hourly rental cost and all-time accumulated cost
- Daily / weekly / monthly accumulators
- Rolling windows (`24h`, `7d`, `30d`)
- Snapshot quality (observed vs estimated)
- Gap-filled hourly continuity when collector runs were missed

## Data Files

- `gpu-cluster-monitor/data/snapshots.json`
- `gpu-cluster-monitor/data/aggregates.json`
- `gpu-cluster-monitor/data/health.json`

## Update Pipeline

The updater script writes one canonical snapshot per UTC hour:

```bash
python3 tools/gpu_monitor/update_gpu_usage.py --allow-fetch-failure
```

Robust behavior:

- If live query fails in a given hour, it copies the previous hour as an estimated snapshot.
- If one or more hourly runs are missing, the next successful run auto-backfills missing hours
  (up to `--backfill-max-hours`, default `72`) using last-known state.
- Live fetch retries are built in (`--fetch-retries`, `--retry-delay-seconds`) before fallback.
- Publisher uses a lock to avoid overlapping runs.

Optional seed from your existing SQLite monitor DB:

```bash
python3 tools/gpu_monitor/update_gpu_usage.py \
  --allow-fetch-failure \
  --seed-sqlite /absolute/path/to/gpu_usage.db
```

## Always-On Background Publishing

### Option A: macOS launchd (recommended for local Adobe-internal collection)

```bash
./tools/gpu_monitor/setup_launchd_macos.sh install \
  --pluto-cmd "python3 -m colligo.pluto.sdk.cli" \
  --sqlite-path /absolute/path/to/gpu_usage.db
```

Status:

```bash
./tools/gpu_monitor/setup_launchd_macos.sh status
```

Uninstall:

```bash
./tools/gpu_monitor/setup_launchd_macos.sh uninstall
```

### Option B: GitHub Actions hourly workflow

Workflow file:

- `.github/workflows/gpu-monitor-hourly.yml`

This workflow is configured for `self-hosted` runners, since Pluto CLI typically needs internal network/auth.

## Cost Model

Node-level costs:

- `H100`: `$55.04/hour`
- `A100`: `$40.97/hour`
- `A100-40GB`: `$32.77/hour`

Cost is computed from active **nodes** each hour.
