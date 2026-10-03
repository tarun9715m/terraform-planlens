# Use in CI

Attach a planlens report to every pull request that changes infrastructure. Reviewers download it and see the full plan, with secrets removed, without access to your cloud account.

## GitHub Actions

```yaml
name: Terraform plan

on: pull_request

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: hashicorp/setup-terraform@v4

      - uses: actions/setup-node@v7
        with:
          node-version: 24

      - run: terraform init -input=false
      - run: terraform plan -input=false -out=tfplan

      - name: Build the planlens report
        run: |
          npm install -g https://github.com/tarun9715m/terraform-planlens/releases/latest/download/terraform-planlens.tgz
          planlens export tfplan -o planlens-report.html

      - uses: actions/upload-artifact@v7
        with:
          name: planlens-report
          path: planlens-report.html
```

The report appears under **Artifacts** on the workflow run. For OpenTofu, use `opentofu/setup-opentofu@v2` and `tofu plan`. planlens finds `tofu` when `terraform` isn't installed.

::: tip Pin a version
In CI, install a fixed release so a new planlens version can't change your pipeline unexpectedly:

```sh
npm install -g https://github.com/tarun9715m/terraform-planlens/releases/download/v0.1.0/terraform-planlens-0.1.0.tgz
```
:::

## Any other CI system

The steps are the same everywhere: Node.js 22 or newer, a saved plan, then:

```sh
npm install -g https://github.com/tarun9715m/terraform-planlens/releases/latest/download/terraform-planlens.tgz
planlens export tfplan -o planlens-report.html
```

Then publish `planlens-report.html` as a build artifact. If the job that runs `terraform plan` can't install Node.js, convert the plan there with `terraform show -json tfplan > plan.json`, and run planlens on `plan.json` in a later job.
