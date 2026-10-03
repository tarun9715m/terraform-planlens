# Shareable reports

`planlens export` writes the viewer and your plan into one HTML file. Anyone can open it in a browser, offline, without installing anything. That makes it useful as a CI artifact, an attachment to a change request, or a link in a pull request.

```sh
planlens export tfplan -o plan-report.html
```

```text
planlens · tfplan · Terraform 1.16.4
  + 8 to create   ~ 9 to update   -/+ 3 to replace   - 7 to destroy

  Wrote plan-report.html (296 KB). Removed 5 sensitive values and 1 value that looks like a secret.
```

The default file name is `planlens-report.html`.

## What a report contains

A report is built from an allow-list. It keeps only what the viewer shows:

- Resource changes, drift and output changes, with their actions and reasons.
- The references between resources, used to explain why values change.

Before writing the file, planlens removes:

| Removed | Why |
|---|---|
| Values Terraform marks sensitive | `terraform show -json` stores them in plain text |
| Values that look like secrets but aren't marked sensitive | Names like `password`, `token`, `api_key`, `SESSION_SECRET` |
| Constant values and variable defaults from the configuration | They can hold hard-coded secrets |
| `variables`, `prior_state`, `planned_values` | Full plain-text copies of values the viewer doesn't need |

Removed values become placeholders that still record whether the value changed. A report still tells you a password changed, but not what it is.

::: warning
Secrets inside longer text can't be detected reliably, for example a password written into a user data script. Read a report before you share it outside your team.
:::

## Keeping sensitive values

```sh
planlens export tfplan --include-sensitive -o plan-private.html
```

This keeps every value in plain text and writes the file readable only by you (mode `600`). Treat it like a credentials file.
