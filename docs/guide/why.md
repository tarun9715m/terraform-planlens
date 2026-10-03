# Why planlens

`terraform plan` is the last check before `terraform apply` changes real infrastructure. On a big plan, its text output makes that check hard, and it leaves out things you need to see.

## What `terraform plan` hides

- **Unchanged attributes.** They're collapsed into `# (12 unchanged attributes hidden)`, even when you need them for context.
- **Sensitive values.** They're printed as `(sensitive value)`. The plan file still holds them in plain text: `terraform show -json` includes every one.
- **Drift.** Changes made outside Terraform are printed only when Terraform decides they matter to the plan. A resource someone deleted by hand can show up as a plain "will be created".
- **Replacements.** The summary line counts a replacement as both an add and a destroy. `Plan: 8 to add, 1 to change, 10 to destroy` can mean six replacements and four real destroys, and you can't tell which.
- **Renames.** Renaming a resource without a `moved` block looks like an unrelated destroy and create. For a database or bucket, that loses data.
- **Encoded values.** Base64 user data shows up as two unreadable blobs. A new `curl … | bash` line in a launch template's user data is invisible.
- **Why things change.** Terraform doesn't say that a Lambda's environment changes because the database it points to is being replaced.
- **Secrets in plain text.** Values that look like secrets but aren't marked sensitive, such as environment variables, are printed as is, including into CI logs.

## What planlens does

planlens reads the JSON form of your plan and shows all of it:

- **Summary:** counts by action, plus a comparison with the summary line Terraform prints.
- **Review by action:** destroys and replacements first, with data-loss warnings.
- **Full diffs:** before and after for every attribute, side by side or in Terraform's own style. Unchanged attributes are one click away.
- **Sensitive values:** masked, can be revealed one at a time, and always show whether they changed.
- **Explanations:** plain-English reasons, and which change causes which.
- **Rename detection** with a ready-made `moved` block.
- **Decoded values:** base64, JSON and multi-line strings are diffed line by line.
- **Drift:** every change made outside Terraform.

It runs on your machine. The plan never leaves it unless you export a report, and reports have secrets removed.

## How it works

1. You save a plan: `terraform plan -out=tfplan`.
2. planlens runs `terraform show -json tfplan` (or `tofu show -json`) to read it.
3. It analyses the plan and serves a self-contained page to your browser on `127.0.0.1`.

There is no account, no API key and no telemetry, and nothing is uploaded.
