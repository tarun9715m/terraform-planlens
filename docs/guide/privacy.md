# Privacy and security

Terraform plans are sensitive: `terraform show -json` includes every sensitive value in plain text. planlens is built so your plan stays on your machine.

## The local viewer

When you run `planlens tfplan`:

- **Address:** the page is served only on `127.0.0.1`, the loopback address, so other machines can't connect.
- **Random URL:** the address contains a random 32-character token. Requests for anything else get `404`.
- **Host check:** requests whose `Host` header isn't that loopback address get `403`. This blocks DNS-rebinding attacks from websites open in your browser.
- **No network requests:** the page's content security policy blocks fetch, XHR, WebSockets, external scripts, styles, fonts and images. Its scripts, styles and fonts are inlined.
- **Memory only:** the plan stays in the planlens process's memory and disappears when you press Ctrl+C. Nothing is written to disk.

Your review progress, theme and layout choices are saved in your browser's local storage.

## Exported reports

Reports are meant to be shared, so they're built from an allow-list. Sensitive values, secret-looking values, configuration constants and variable defaults are removed. See [Shareable reports](./reports) for the details and the one limit: secrets inside longer text such as scripts.

## What planlens never does

- Upload your plan anywhere
- Collect telemetry
- Need a cloud account, an API key or a login

## Reporting a vulnerability

Use [private vulnerability reporting](https://github.com/tarun9715m/terraform-planlens/security/advisories/new) on GitHub, not a public issue.
