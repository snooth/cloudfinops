# Deploy FinOps mirror on firmgate.io/finops

Corporate networks may block **https://iamfinops.com.au** but allow **https://firmgate.io**.
This guide runs a second copy of the Cloud FinOps portal at:

**https://firmgate.io/finops/**

Primary site (unchanged): **https://iamfinops.com.au/**

## Architecture

```
Internet
  ├─ iamfinops.com.au  ──nginx──► 127.0.0.1:4000  (BASE_PATH empty, root build)
  └─ firmgate.io
       ├─ /            ──nginx──► Firmgate (existing)
       └─ /finops/     ──nginx──► 127.0.0.1:4001  (BASE_PATH=/finops, firmgate build)
```

## 1. Copy app onto the server

Deploy the Cloud FinOps tree beside your existing install (example paths):

```bash
# e.g. same machine as iamfinops
sudo mkdir -p /opt/cloud-finops-firmgate
# copy release or git clone into that directory
cd /opt/cloud-finops-firmgate
npm install
```

## 2. Environment for the Firmgate path mirror

Create `/opt/cloud-finops-firmgate/.env` (do not reuse port 4000 if iamfinops already uses it):

```env
PORT=4001
HOST=127.0.0.1
BASE_PATH=/finops
VITE_BASE_PATH=/finops
AZURE_REGION=australiaeast
AZURE_CURRENCY=AUD
AZURE_PRICING_ONLINE=false
```

## 3. Build the client for `/finops`

```bash
cd /opt/cloud-finops-firmgate
npm run build:firmgate
# equivalent: VITE_BASE_PATH=/finops npm run build -w client
```

Confirm `client/dist/index.html` references assets under `/finops/assets/`.

## 4. Run the process

**Manual test:**

```bash
BASE_PATH=/finops PORT=4001 HOST=127.0.0.1 npm start
curl -sI http://127.0.0.1:4001/finops/ | head -5
curl -s http://127.0.0.1:4001/finops/api/dashboard | head -c 200
```

**systemd example** (`/etc/systemd/system/cloud-finops-firmgate.service`):

```ini
[Unit]
Description=Cloud FinOps portal (firmgate.io/finops)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/cloud-finops-firmgate
EnvironmentFile=/opt/cloud-finops-firmgate/.env
ExecStart=/usr/bin/npm start
Restart=on-failure
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cloud-finops-firmgate
```

## 5. nginx on firmgate.io

Add the contents of `deploy/nginx-firmgate-finops.conf` into the **HTTPS**
`server { server_name firmgate.io; ... }` block (or include it):

```nginx
include /etc/nginx/snippets/firmgate-finops.conf;
```

Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Verify

From a network that can reach firmgate.io:

| Check | Expect |
|-------|--------|
| https://firmgate.io/finops | Redirect to `/finops/` |
| https://firmgate.io/finops/ | Landing / disclaimer page |
| https://firmgate.io/finops/api/dashboard | JSON portfolio summary |
| https://iamfinops.com.au/ | Unchanged root portal |

## Notes

- **Two builds**: root site and `/finops` mirror use different Vite `base` values; do not mix a root build with `BASE_PATH=/finops` (assets 404).
- **Separate data**: port 4001 uses its own `server/data/` unless you symlink/share files deliberately.
- **TLS**: firmgate.io already terminates HTTPS; FinOps process only listens on localhost.
- **Corporate block of iamfinops only**: users open **https://firmgate.io/finops/** — no DNS change on the corporate side required.
