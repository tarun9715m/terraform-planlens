terraform {
  required_providers {
    random = { source = "hashicorp/random" }
    local  = { source = "hashicorp/local" }
  }
}

variable "db_password" {
  type      = string
  sensitive = true
  default   = "hunter2-new"
}

resource "terraform_data" "app" {
  input = {
    name     = "app"
    size     = 2
    tags     = { env = "prod", team = "core" }
    ports    = [80, 443, 8080]
    password = var.db_password
    policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "*" }] })
    script   = "#!/bin/bash\necho hello\napt-get update\napt-get install -y nginx\n"
    rules    = [{ port = 443, cidr = "0.0.0.0/0" }, { port = 22, cidr = "10.0.0.0/8" }]
  }
}

resource "terraform_data" "replaceme" {
  input            = "v1"
  triggers_replace = ["ami-222"]
}

resource "terraform_data" "cbd" {
  input            = "cbd"
  triggers_replace = "two"
  lifecycle { create_before_destroy = true }
}

resource "terraform_data" "counted" {
  count = 2
  input = "node-${count.index}"
}

resource "terraform_data" "eached" {
  for_each = toset(["a", "b"])
  input    = each.key
}

moved {
  from = terraform_data.old_name
  to   = terraform_data.new_name
}
resource "terraform_data" "new_name" { input = "moving" }

removed {
  from = terraform_data.forgetme
  lifecycle { destroy = false }
}

resource "terraform_data" "tainted" { input = "t" }
resource "terraform_data" "byreq" { input = "r" }

resource "terraform_data" "trig" {
  input = "trig"
  lifecycle { replace_triggered_by = [terraform_data.replaceme] }
}

resource "terraform_data" "brand_new" {
  input = { x = 1, secret = sensitive("s3cr3t") }
}

resource "random_password" "db" { length = 16 }

import {
  to = random_string.imported
  id = "importme"
}
resource "random_string" "imported" { length = 8 }

resource "local_file" "cfg" {
  filename = "${path.module}/out/cfg.txt"
  content  = "v2"
}

data "local_file" "readback" { filename = local_file.cfg.filename }

resource "local_file" "drifted" {
  filename = "${path.module}/out/drifted.txt"
  content  = "drift me"
}

output "app_out" {
  value     = terraform_data.app.output
  sensitive = true
}
output "count" { value = length(terraform_data.counted) }
output "brand_new_out" { value = terraform_data.brand_new.output }
output "readback" { value = data.local_file.readback.content }
