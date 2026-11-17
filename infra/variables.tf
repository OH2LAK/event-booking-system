variable "hcloud_token" {
  type      = string
  sensitive = true
}
variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}
variable "cloudflare_account_id" { type = string }
variable "cloudflare_zone_id" { type = string }
variable "domain" {
  type    = string
  default = "hamradio-events.com"
}
variable "server_type" {
  type    = string
  default = "cx32"   # check current Hetzner types/prices before applying
}
variable "location" {
  type    = string
  default = "hel1"
}
variable "ssh_public_key" { type = string }
variable "ssh_allowed_cidrs" {
  type        = list(string)
  description = "Your own IP ranges allowed to SSH, e.g. [\"203.0.113.5/32\"]"
}
