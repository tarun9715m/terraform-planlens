---
layout: home

hero:
  name: planlens
  text: See what your Terraform plan really does
  tagline: Every create, update, replace and destroy in one clear view, including the parts terraform plan hides. Runs on your machine; nothing leaves it.
  image:
    src: /logo.svg
    alt: planlens
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Install
      link: /guide/installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/tarun9715m/terraform-planlens

features:
  - title: Destructive changes first
    details: Every change is grouped into destroy, replace, update and create, so a database replacement is never buried in a 300-resource plan.
  - title: Nothing hidden
    details: Unchanged attributes, sensitive values, drift and decoded base64 and JSON are all one click away.
  - title: Catches costly mistakes
    details: It flags renames that would destroy a resource, data-loss risks like skip_final_snapshot, and secrets printed in plain text.
  - title: Explains why
    details: Each resource gets a plain-English reason, and each value shows which other change caused it.
  - title: Private by design
    details: The viewer is served only to your browser and makes no network requests. Shareable reports have secrets removed.
  - title: Terraform and OpenTofu
    details: Reads saved plan files or plan JSON. No account, no API key, no telemetry.
---

<div class="home-shot">

![planlens showing a plan summary, the review panel and what terraform plan hides](/screenshots/overview.png)

</div>
