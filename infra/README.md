# Infrastructure (Terraform)

Creates the hosting VPS (Hetzner), its firewall (SSH from your IPs only; no web ports), the Cloudflare Tunnel and
the DNS records (`*` and `platform` → tunnel). After `terraform apply`, follow `platform/README.md` to finish
the server (database password, control-plane settings, start the services).

> **Status: not validated.** These files were written without access to `terraform validate/plan`. Run
> `terraform init && terraform validate && terraform plan` first and check provider versions and the Cloudflare
> resource names against the current provider docs; they change between major versions.

```bash
cd infra
export TF_VAR_hcloud_token=...  TF_VAR_cloudflare_api_token=...   # never commit these
terraform init
terraform plan -var cloudflare_account_id=... -var cloudflare_zone_id=... \
  -var ssh_public_key="$(cat ~/.ssh/id_ed25519.pub)" -var 'ssh_allowed_cidrs=["YOUR.IP/32"]'
terraform apply   # same variables
```

The Cloudflare token needs: Account → Cloudflare Tunnel: Edit; Zone → DNS: Edit. State contains the tunnel secret,
so keep it private (use a remote backend with encryption if you share it).
