# GPU Cluster Monitor (Hidden Subpage)

This dashboard is intentionally **not linked** from the homepage navigation.
Access it directly via:

- `https://xingjianbai.com/gpu-cluster-monitor/`
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

Market-price definition:

- AWS EC2 On-Demand public pricing in `us-east-1`
- Filters: `OperatingSystem=Linux`, `Tenancy=Shared`, `CapacityStatus=Used`, `OnDemand`
- Reference publication used for pinned rates: `2026-03-04T22:42:40Z`

Node-level costs:

- `H100` (`p5.48xlarge`): `$55.04/hour` (`$6.88/GPU-hour`)
- `A100` (`p4de.24xlarge`): `$27.44705/hour` (`$3.43088/GPU-hour`)
- `A100-40GB` (`p4d.24xlarge`): `$21.957642/hour` (`$2.74471/GPU-hour`)

Authentic source links:

- https://aws.amazon.com/ec2/pricing/on-demand/
- https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-1/index.csv
- https://aws.amazon.com/ec2/instance-types/p5/
- https://aws.amazon.com/ec2/instance-types/p4/

Cost is computed from active **nodes** each hour, then accumulated into daily/weekly/monthly and all-time metrics.
