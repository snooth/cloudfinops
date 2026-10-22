# Cloud FinOps

Cost modeler for Azure workloads in **AUD**. Point it at a portfolio of apps (AKS, ARO, VMs), tweak sizing, and see what the monthly bill roughly looks like before you spend the money.

Built for Australia East pricing. Retail rates are a guide — not your invoice — unless you also wire Cost Management.

## What you get

- Portfolio dashboard in AUD
- T-shirt sizes (S/M/L/XL) per app
- Drivers (e.g. “another Cloudera dataset” → storage + nodes + system cost)
- Build-your-own apps from platform templates or retail meters
- Save-money SKU swaps against the catalog
- Per-login tenancy (each user keeps their own portfolio)
- Optional firmgate-style mount under `/finops`

## Quick start

```bash
chmod +x run.sh
cp .env.example .env
./run.sh start
```

Open http://localhost:4000 — first login is `admin` / `password` (it’ll make you change it).

```bash
./run.sh dev      # API :4000 + Vite :5173
./run.sh status
./run.sh stop
./run.sh restart
```

## Offline catalog

Want real meter-level numbers:

1. Start the portal
2. Configuration → **Download Full Azure Catalog (AUD)**
3. Wait once (needs network). After that you’re offline-friendly.

## Config

Copy `.env.example` → `.env`:

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `4000` | API port |
| `HOST` | `0.0.0.0` | Bind address |
| `BASE_PATH` | _(empty)_ | Set `/finops` for a path mount |
| `AZURE_REGION` | `australiaeast` | Retail region |
| `AZURE_CURRENCY` | `AUD` | Keep it AUD |
| `AZURE_*` SP bits | optional | Cost Management Reader if you want actuals |

## Sharing a copy

```bash
chmod +x scripts/pack-share.sh
./scripts/pack-share.sh
```

Zip lands in `releases/`. See **SHARE.md** for what is / isn’t included.

## Firmgate mirror

Corporate nets that block iamfinops but allow firmgate: run a second copy with `BASE_PATH=/finops` on port 4001. Steps in `deploy/FIRMGATE-FINOPS.md`.

```bash
npm run build:firmgate
BASE_PATH=/finops PORT=4001 npm start
```

## Layout

```
├── run.sh
├── client/          # React UI
├── server/          # Express API + pricing
├── deploy/          # nginx / firmgate notes
└── scripts/         # version bump + share packer
```

## Requirements

Node 18+, npm 9+.
