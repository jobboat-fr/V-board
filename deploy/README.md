# Deploy Guide

## Option A — Single Server, Docker Compose (recommended)

### First-Time Setup

```bash
# 1. Clone the repo on your server
git clone https://github.com/azzco-labs/v-board.git /opt/v-board
cd /opt/v-board

# 2. Configure
cp .env.example .env
nano .env   # fill in AZZCO_COUNCIL_TOKEN, AZZCO_API_TOKEN, AZZCO_OWNER_WHATSAPP

# 3. Run the setup script
bash deploy/install-hostinger.sh

# 4. Mount your crontab (runner container)
cp packages/runner/crontab.example /etc/azzco-crontab
# Then add to your docker-compose.yml override:
# services:
#   runner:
#     volumes:
#       - /etc/azzco-crontab:/etc/azzco-crontab:ro
```

### CI/CD — GitHub Actions Secrets

Add these secrets at: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | Your server IP |
| `DEPLOY_SSH_KEY` | Contents of your CI SSH private key |
| `DEPLOY_USER` | SSH user (`root` or `ubuntu`) |

### Generating a Deploy-Only SSH Key (recommended)

```bash
# Generate CI deploy key pair (no passphrase)
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/id_ed25519_ci_deploy -N ""

# Add public key to server's authorized_keys
ssh root@YOUR_SERVER_IP \
  "echo '$(cat ~/.ssh/id_ed25519_ci_deploy.pub)' >> ~/.ssh/authorized_keys"

# Put the PRIVATE key into GitHub secret as DEPLOY_SSH_KEY
```

---

## Option B — Two Servers, Bare Node

For deployments across two separate VPS instances (e.g. original Hostinger + OVH design).

### Server 1 — ops-core + runner

```bash
scp deploy/install-hostinger.sh root@SERVER1_IP:~/
ssh root@SERVER1_IP
# Edit to set VBOARD_REPO or install manually
bash install-hostinger.sh
```

### Server 2 — council

```bash
scp deploy/install-ovh.sh ubuntu@SERVER2_IP:~/
ssh ubuntu@SERVER2_IP
sudo bash install-ovh.sh

# Fill in env files
sudo nano /etc/azzco-council.env       # AZZCO_COUNCIL_TOKEN + HUGGINGFACE_TOKEN
sudo nano /etc/azzco-ops-core.env      # AZZCO_API_TOKEN

# Start services
sudo systemctl start azzco-council
sudo systemctl start azzco-ops-core
sudo systemctl status azzco-council
sudo systemctl status azzco-ops-core
```

For two-server CI/CD, add additional secrets:

| Secret | Value |
|---|---|
| `HOSTINGER_HOST` | Server 1 IP |
| `HOSTINGER_SSH_KEY` | SSH private key for server 1 |
| `OVH_HOST` | Server 2 IP |
| `OVH_SSH_KEY` | SSH private key for server 2 |

---

## Manual Deploy (Docker Compose, no CI)

```bash
# On the server
cd /opt/v-board
git pull origin main

# Rebuild and restart
docker compose build --no-cache ops-core council
docker compose up -d

# Verify
curl http://127.0.0.1:8788/health
docker compose ps
```

## Manual Deploy (Two-Server Bare Node, no CI)

```bash
# Deploy ops-core to server 1
rsync -az --exclude=node_modules --exclude=.secrets \
  -e "ssh -i ~/.ssh/id_ed25519" \
  packages/ops-core/ \
  root@SERVER1_IP:/opt/azzco-ops-core/

# Deploy council to server 2
rsync -az --exclude=node_modules \
  -e "ssh -i ~/.ssh/id_ed25519_ovh" \
  packages/council/ \
  ubuntu@SERVER2_IP:/opt/azzco-council/core/

ssh ubuntu@SERVER2_IP "
  cd /opt/azzco-council/core
  node scripts/smoke_test.js && node scripts/hardening_test.js
  sudo systemctl restart azzco-council
"
```
