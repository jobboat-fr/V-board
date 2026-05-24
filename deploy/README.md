# Deploy Guide

## First-Time Server Setup

### OVH

```bash
# SSH into OVH, copy and run the install script
scp -i ~/.ssh/id_ed25519_ovh_azzco deploy/install-ovh.sh ubuntu@YOUR_OVH_IP:~/
ssh -i ~/.ssh/id_ed25519_ovh_azzco ubuntu@YOUR_OVH_IP
sudo bash install-ovh.sh

# Then fill in the env files and start services:
sudo nano /etc/azzco-council.env       # Set AZZCO_COUNCIL_TOKEN + HUGGINGFACE_TOKEN
sudo nano /etc/azzco-ops-core.env      # Set AZZCO_API_TOKEN

# Stop the current bare-node processes:
pkill -f 'node /opt/azzco-council' || true
pkill -f 'node src/cli.js api' || true

# Start via systemd:
sudo systemctl start azzco-council
sudo systemctl start azzco-ops-core
sudo systemctl status azzco-council
sudo systemctl status azzco-ops-core
```

### Hostinger

```bash
scp -i ~/.ssh/id_ed25519 deploy/install-hostinger.sh root@YOUR_HOSTINGER_IP:~/
ssh -i ~/.ssh/id_ed25519 root@YOUR_HOSTINGER_IP
bash install-hostinger.sh
```

---

## CI/CD — GitHub Actions Secrets

Add these secrets to your GitHub repo at:
**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|---|---|
| `HOSTINGER_HOST` | Your Hostinger server IP |
| `HOSTINGER_SSH_KEY` | Contents of `~/.ssh/id_ed25519` (Hostinger private key) |
| `OVH_HOST` | Your OVH server IP |
| `OVH_SSH_KEY` | Contents of `~/.ssh/id_ed25519_ovh_azzco` (OVH private key) |

### Generating Deploy-Only SSH Keys (Recommended)

Use dedicated CI keys — never put your personal keys in GitHub secrets:

```bash
# Generate CI deploy key pair (no passphrase)
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/id_ed25519_ci_deploy -N ""

# Add public key to Hostinger's authorized_keys:
ssh -i ~/.ssh/id_ed25519 root@YOUR_HOSTINGER_IP \
  "echo '$(cat ~/.ssh/id_ed25519_ci_deploy.pub)' >> ~/.ssh/authorized_keys"

# Add public key to OVH's authorized_keys:
ssh -i ~/.ssh/id_ed25519_ovh_azzco ubuntu@YOUR_OVH_IP \
  "echo '$(cat ~/.ssh/id_ed25519_ci_deploy.pub)' >> ~/.ssh/authorized_keys"

# Put the PRIVATE key (id_ed25519_ci_deploy) into GitHub secrets as HOSTINGER_SSH_KEY / OVH_SSH_KEY
```

---

## Manual Deploy (Without CI)

```bash
# Deploy ops-core to Hostinger manually
rsync -az --exclude=node_modules --exclude=.secrets \
  -e "ssh -i ~/.ssh/id_ed25519" \
  packages/ops-core/ \
  root@YOUR_HOSTINGER_IP:/tmp/ops-core-deploy/

ssh -i ~/.ssh/id_ed25519 root@YOUR_HOSTINGER_IP "
  docker cp /tmp/ops-core-deploy/. openclaw-uix8-openclaw-1:/data/.openclaw/workspace/azzco-ops-core/
  docker exec openclaw-uix8-openclaw-1 sh -c 'cd /data/.openclaw/workspace/azzco-ops-core && npm ci && npm test'
"

# Deploy council to OVH manually
rsync -az --exclude=node_modules \
  -e "ssh -i ~/.ssh/id_ed25519_ovh_azzco" \
  packages/council/ \
  ubuntu@YOUR_OVH_IP:/opt/azzco-council/core/

ssh -i ~/.ssh/id_ed25519_ovh_azzco ubuntu@YOUR_OVH_IP "
  cd /opt/azzco-council/core
  node scripts/smoke_test.js && node scripts/hardening_test.js
  sudo systemctl restart azzco-council
"
```
