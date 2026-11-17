terraform {
  required_version = ">= 1.6"
  required_providers {
    hcloud     = { source = "hetznercloud/hcloud", version = "~> 1.48" }
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.40" }
    random     = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "hcloud" { token = var.hcloud_token }
provider "cloudflare" { api_token = var.cloudflare_api_token }

resource "random_password" "tunnel_secret" {
  length  = 48
  special = false
}

# Cloudflare Tunnel: the VPS needs no open web ports at all.
resource "cloudflare_zero_trust_tunnel_cloudflared" "ebs" {
  account_id = var.cloudflare_account_id
  name       = "ebs-hosting"
  secret     = base64encode(random_password.tunnel_secret.result)
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "ebs" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.ebs.id
  config {
    ingress_rule {
      hostname = "platform.${var.domain}"
      service  = "http://localhost:8080"
    }
    ingress_rule {
      hostname = "*.${var.domain}"
      service  = "http://localhost:8081"   # Traefik routes by Host header
    }
    ingress_rule { service = "http_status:404" }
  }
}

# platform.<domain> is covered by the wildcard too, but an explicit record keeps intent clear.
resource "cloudflare_record" "wildcard" {
  zone_id = var.cloudflare_zone_id
  name    = "*"
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.ebs.id}.cfargotunnel.com"
  proxied = true
}
resource "cloudflare_record" "platform" {
  zone_id = var.cloudflare_zone_id
  name    = "platform"
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.ebs.id}.cfargotunnel.com"
  proxied = true
}

resource "hcloud_ssh_key" "admin" {
  name       = "ebs-admin"
  public_key = var.ssh_public_key
}

resource "hcloud_firewall" "ebs" {
  name = "ebs-hosting"
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.ssh_allowed_cidrs
  }
  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "ebs" {
  name         = "ebs-hosting"
  server_type  = var.server_type
  image        = "ubuntu-24.04"
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.admin.id]
  firewall_ids = [hcloud_firewall.ebs.id]
  user_data = templatefile("${path.module}/cloud-init.yaml", {
    tunnel_token = base64encode(jsonencode({
      a = var.cloudflare_account_id
      t = cloudflare_zero_trust_tunnel_cloudflared.ebs.id
      s = base64encode(random_password.tunnel_secret.result)
    }))
  })
}
