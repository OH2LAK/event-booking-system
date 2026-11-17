output "server_ipv4" { value = hcloud_server.ebs.ipv4_address }
output "tunnel_id" { value = cloudflare_zero_trust_tunnel_cloudflared.ebs.id }
