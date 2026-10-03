#!/usr/bin/env bash
# Regenerate test/fixtures/real-terraform-1.16.json from a real Terraform run.
# Uses only local providers (terraform_data, random, local), so no cloud credentials are needed.
# Set TERRAFORM=tofu to produce an OpenTofu plan instead.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
tf="${TERRAFORM:-terraform}"
out="${1:-$root/test/fixtures/real-terraform-1.16.json}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cp -R "$root/test/fixtures/tf-local/modules" "$work/"
cp "$root/test/fixtures/tf-local/steps/1-initial/main.tf" "$work/main.tf"
cd "$work"
mkdir -p out
"$tf" init -input=false -no-color >/dev/null
"$tf" apply -auto-approve -input=false -no-color >/dev/null

# Changes made outside Terraform, then the new configuration.
"$tf" taint -no-color terraform_data.tainted >/dev/null
rm -f out/drifted.txt
cp "$root/test/fixtures/tf-local/steps/2-changed/main.tf" main.tf

"$tf" plan -input=false -no-color -out=tfplan -replace=terraform_data.byreq >/dev/null
"$tf" show -json tfplan > "$out"
echo "wrote $out"
