# Sharing this cost modeler

Zip built for someone else to run locally. Secrets and live tenant data stay off the stick.

## What’s in the pack

- App source (`client/`, `server/`)
- `run.sh`, `package.json`, lockfile
- `.env.example` (copy to `.env`)
- Baseline pricing snapshot under `server/data/` (no live auth users, no sessions, no tenant portfolios)
- Deploy notes for firmgate under `deploy/` if you need the `/finops` mirror

## What’s deliberately left out

- `.env` and `admin-auth.json` (passwords)
- `server/data/tenants/` (each login’s private portfolio)
- `sessions.json`, retail catalog dump (huge — re-download from Config if you want the full meter list)
- `node_modules/`, `client/dist/`, old release zips

## Get it running

```bash
unzip Cloud-FinOps-share-*.zip
cd Cloud-FinOps-share-*   # or whatever you called the folder
cp .env.example .env
chmod +x run.sh
./run.sh start
```

Open http://localhost:4000

First boot creates a default `admin` / `password` account and forces a password change. That’s intentional.

Dev mode with hot reload:

```bash
./run.sh dev
```

## Notes for whoever you hand this to

- Figures are **AUD**, Australia East retail rates by default.
- Retail ≠ invoice. Wire Cost Management creds in `.env` if you want billed spend alongside the model.
- Full offline catalog: Configuration → Download Full Azure Catalog (one-off, needs network).
- Corporate path mount: set `BASE_PATH=/finops` and build with `npm run build:firmgate` — see `deploy/FIRMGATE-FINOPS.md`.
