# Changelog

All notable changes to planlens are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-03

First release.

### Added

- **Commands:**
  - `planlens <plan>` opens a saved plan file or plan JSON in a local browser viewer.
  - `planlens export <plan>` writes a self-contained HTML report with secrets removed.
  - `planlens demo` opens an illustrative AWS plan.
- **Reading plans:**
  - Saved plan files are converted with `terraform show -json`, falling back to OpenTofu.
  - Plan JSON can also be read from stdin.
- **Summary:** counts for create, update in place, replace and destroy, and a comparison with the `Plan:` line `terraform plan` prints.
- **Review by action:** every change grouped into destroy, replace, update, create and other, with notes on resources that hold data, likely renames and drift.
- **Show filter:** a filter above the change list, kept in sync with the summary tiles. The list itself is grouped by action.
- **Diffs:**
  - Full attribute diffs, side by side or in plan style.
  - Unchanged attributes, which `terraform plan` hides, are one click away.
- **Sensitive values** are masked, can be revealed one at a time, and always show whether they changed.
- **Explanations:**
  - Plain-English reasons for every resource, including which attributes force a replacement.
  - Why each value changes: which other resource it comes from, which data source supplies it, or that it reverts a change made outside Terraform.
- **Rename detection** with ready-made `moved` blocks, including switches from `count` to `for_each`.
- **Data-loss warnings:** resources that hold data, `skip_final_snapshot`, `deletion_protection = false`, `force_destroy`, and replacements that destroy the old object first.
- **Drift:** changes made outside Terraform, including the ones `terraform plan` doesn't print.
- **Decoded values:** JSON documents, base64 text such as user data, and multi-line strings are diffed line by line.
- **Unmarked secrets:** warnings for values that look like secrets but aren't marked sensitive.
- **Viewer extras:**
  - output changes;
  - review progress;
  - keyboard shortcuts;
  - light and dark themes;
  - a Markdown summary to copy.
- **Privacy:** the viewer is served only to 127.0.0.1 at a random URL, and its content security policy blocks all network requests.

[Unreleased]: https://github.com/tarun9715m/terraform-planlens/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tarun9715m/terraform-planlens/releases/tag/v0.1.0
