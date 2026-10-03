# Troubleshooting

## `terraform show -json failed`

Terraform can only read a saved plan in the working directory that created it, after `terraform init`, with the same providers.

- Run planlens in the directory where you ran `terraform plan`, or pass `--chdir <dir>`.
- Run `terraform init` there first if `.terraform` is missing.
- Use the same Terraform version that created the plan.

You can always convert the plan yourself and pass the JSON:

```sh
terraform show -json tfplan > plan.json
planlens plan.json
```

## `Couldn't find terraform on your PATH`

planlens needs `terraform`, or `tofu`, only to read saved plan files. Either:

- install Terraform or OpenTofu;
- point planlens at the binary with `--bin /path/to/terraform`;
- pass plan JSON instead of the saved plan.

## `is the text output of terraform plan`

planlens needs the JSON form of a plan, not the printed text. Save the plan with `-out=tfplan`, then pass the file, or `terraform show -json tfplan > plan.json`.

## `npm` says the engine is unsupported, or planlens fails to start

planlens needs Node.js 22 or newer. Check with `node --version` and upgrade; see [Installation](./installation).

## The browser didn't open

Copy the `Viewer:` address from the terminal into your browser. On a machine without a desktop, use `--no-open` and an SSH tunnel; see [Getting started](./getting-started#on-a-remote-machine).

## The page says `Forbidden`

The viewer only answers requests addressed to `127.0.0.1` or `localhost` on its own port. Open the exact address planlens printed. When tunnelling, use the same port number on both ends.

## `Couldn't start the viewer on port …`

Another program is using that port. Leave out `--port` to use any free port, or pick a different one.

## The page is blank

planlens needs a browser from the last few years: current Chrome, Edge, Firefox or Safari.

## A report shows `(sensitive value)`

That's intended: reports have sensitive values removed. To keep them, export with `--include-sensitive` and treat the file as a secret. See [Shareable reports](./reports).
