# Deploy Guide

## Option A â€” Single Server, Docker Compose (recommended)

### First-Time Setup

```bash
# 1. Clone the repo on your server
git clone https://github.com/your-org/v-board.git /opt/v-board
cd /opt/v-board

# 2. Configure
cp .env.example .env
nano .env   # fill in VBOARD_COUNCIL_TOKEN, VBOARD_API_TOKEN, VBOARD_OWNER_WHATSAPP

# 3. Run the setup script
bash deploy/install-front-desk.sh

# 4. Mount your crontab (runner container)
cp packages/runner/crontab.example /etc/vboard-crontab
# Then add to your docker-compose.yml override:
# services:
#   runner:
#     volumes:
#       - /etc/vboard-crontab:/etc/vboard-crontab:ro
```

### CI/CD â€” GitHub Actions Secrets

Add these secrets at: **Settings â†’ Secrets and variables â†’ Actions â†’ New repository secret**

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
ssh deploy@YOUR_SERVER_IP \
  "echo '$(cat ~/.ssh/id_ed25519_ci_deploy.pub)' >> ~/.ssh/authorized_keys"

# Put the PRIVATE key into GitHub secret as DEPLOY_SSH_KEY
```

---

## Option B â€” Two Servers, Bare Node

For deployments across two separate VPS instances (e.g. original front desk server + back office server design).

### Server 1 â€” ops-core + runner

```bash
scp deploy/install-front-desk.sh deploy@SERVER1_IP:~/
ssh deploy@SERVER1_IP
# Edit to set VBOARD_REPO or install manually
bash install-front-desk.sh
```

### Server 2 â€” council

```bash
scp deploy/install-back-office.sh ubuntu@SERVER2_IP:~/
ssh ubuntu@SERVER2_IP
sudo bash install-back-office.sh

# Fill in env files
sudo nano /etc/vboard-council.env       # VBOARD_COUNCIL_TOKEN + LLM_API_TOKEN
sudo nano /etc/vboard-ops-core.env      # VBOARD_API_TOKEN

# Start services
sudo systemctl start vboard-council
sudo systemctl start vboard-ops-core
sudo systemctl status vboard-council
sudo systemctl status vboard-ops-core
```

For two-server CI/CD, add additional secrets:

| Secret | Value |
|---|---|
| `FRONT_DESK_HOST` | Server 1 IP |
| `FRONT_DESK_SSH_KEY` | SSH private key for server 1 |
| `BACK_OFFICE_HOST` | Server 2 IP |
| `BACK_OFFICE_SSH_KEY` | SSH private key for server 2 |

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
  deploy@SERVER1_IP:/opt/vboard-ops-core/

# Deploy council to server 2
rsync -az --exclude=node_modules \
  -e "ssh -i ~/.ssh/id_ed25519_back-office" \
  packages/council/ \
  ubuntu@SERVER2_IP:/opt/vboard-council/core/

ssh ubuntu@SERVER2_IP "
  cd /opt/vboard-council/core
  node scripts/smoke_test.js && node scripts/hardening_test.js
  sudo systemctl restart vboard-council
"
```

