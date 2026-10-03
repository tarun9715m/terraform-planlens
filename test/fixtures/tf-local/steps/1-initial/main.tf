terraform {
  required_providers {
    random = { source = "hashicorp/random" }
    local  = { source = "hashicorp/local" }
  }
}

variable "db_password" {
  type      = string
  sensitive = true
  default   = "hunter2-old"
}

resource "terraform_data" "app" {
  input = {
    name     = "app"
    size     = 1
    tags     = { env = "staging", team = "core" }
    ports    = [80, 443]
    password = var.db_password
    policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["s3:GetObject"], Resource = "*" }] })
    script   = "#!/bin/bash\necho hello\napt-get update\n"
    rules    = [{ port = 80, cidr = "0.0.0.0/0" }, { port = 22, cidr = "10.0.0.0/8" }]
  }
}

resource "terraform_data" "replaceme" {
  input            = "v1"
  triggers_replace = ["ami-111"]
}

resource "terraform_data" "cbd" {
  input            = "cbd"
  triggers_replace = "one"
  lifecycle { create_before_destroy = true }
}

resource "terraform_data" "counted" {
  count = 3
  input = "node-${count.index}"
}

resource "terraform_data" "eached" {
  for_each = toset(["a", "b", "c"])
  input    = each.key
}

resource "terraform_data" "gone" { input = "will be removed from config" }
resource "terraform_data" "old_name" { input = "moving" }
resource "terraform_data" "forgetme" { input = "forget" }
resource "terraform_data" "tainted" { input = "t" }
resource "terraform_data" "byreq" { input = "r" }

resource "terraform_data" "trig" {
  input = "trig"
  lifecycle { replace_triggered_by = [terraform_data.replaceme] }
}

resource "random_password" "db" { length = 16 }

resource "local_file" "cfg" {
  filename = "${path.module}/out/cfg.txt"
  content  = "v1"
}

resource "local_file" "drifted" {
  filename = "${path.module}/out/drifted.txt"
  content  = "drift me"
}

module "legacy" { source = "./modules/legacy" }

output "app_out" {
  value     = terraform_data.app.output
  sensitive = true
}
output "count" { value = length(terraform_data.counted) }
output "to_remove" { value = "bye" }
