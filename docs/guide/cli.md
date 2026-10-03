# CLI reference

```text
planlens <plan>                    Open the plan in your browser
planlens export <plan> [-o file]   Write a shareable HTML report, with secrets removed
planlens demo                      Open a demo plan
```

## The plan argument

| You pass | planlens does |
|---|---|
| A saved plan file (`terraform plan -out=tfplan`) | Runs `terraform show -json` on it, falling back to `tofu` if `terraform` isn't installed |
| Plan JSON (`terraform show -json tfplan > plan.json`) | Reads it directly; Terraform isn't needed |
| `-` | Reads plan JSON from stdin |

Saved plan files can only be read in the Terraform working directory that created them, after `terraform init`. Run planlens there, or pass `--chdir`.

## Commands

### `planlens <plan>`

Prints a summary, serves the viewer on `127.0.0.1` and opens your browser. It runs until you press Ctrl+C. `planlens view <plan>` is the same command, spelled out.

### `planlens export <plan>`

Writes a self-contained HTML report with sensitive and secret-looking values removed. See [Shareable reports](./reports).

### `planlens demo`

Opens an illustrative AWS plan, so you can try planlens without a plan of your own.

## Options

| Option | Description |
|---|---|
| `-o, --out <file>` | Report file for `export`. Default: `planlens-report.html` |
| `--include-sensitive` | Keep sensitive values in the report. The file is written with mode `600`. |
| `--chdir <dir>` | Directory to run `terraform show` in. Default: the current directory |
| `--tofu` | Use OpenTofu (`tofu`) to read saved plan files |
| `--bin <path>` | The `terraform` or `tofu` binary to use |
| `--port <n>` | Port for the viewer. Default: any free port |
| `--no-open` | Print the viewer address instead of opening a browser |
| `-h, --help` | Show help |
| `-v, --version` | Show the version |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | The plan couldn't be read or the report couldn't be written; the message says why |
| `2` | Invalid arguments |

## Environment

| Variable | Effect |
|---|---|
| `NO_COLOR` | Turns off colors in terminal output |

When planlens runs `terraform show`, it sets `TF_IN_AUTOMATION=1` so Terraform skips interactive hints.
