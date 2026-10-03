# Security policy

planlens handles Terraform plans, and `terraform show -json` stores every sensitive value in plain text. Security reports get priority.

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Please don't open a public issue for security problems.

Include the planlens version (`planlens --version`), what you ran, and what you saw. If a plan file is involved, remove real secrets first.

## Supported versions

Fixes go into the latest release.

## What planlens guarantees

- **The local viewer:**
  - It is served only on `127.0.0.1`, at a URL with a random token.
  - It refuses requests whose Host header isn't that loopback address, which blocks DNS rebinding.
  - It serves nothing else.
- **No network requests:** the page's content security policy blocks all of them. Scripts, styles and fonts are inlined.
- **Exported reports:**
  - Values Terraform marks sensitive are replaced, and so are values that look like secrets.
  - Configuration constants, variable defaults, prior state and planned values are left out.
  - With `--include-sensitive`, the report keeps plain-text values and is written readable only by its owner.

## Known limits

Secrets inside multi-line text, such as a password written into a user data script, can't be detected reliably. Check a report before you share it.
