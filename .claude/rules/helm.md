---
paths:
  - "**/Chart.yaml"
  - "**/{charts,helm}/**/values*.{yaml,yml}"
  - "**/{charts,helm}/**/values.schema.json"
  - "**/{charts,helm}/**/templates/**/*.{yaml,yml,tpl}"
  - "**/{charts,helm}/**/crds/**/*.{yaml,yml}"
---

# Helm

## Values and rendering

- Keep chart values compatible with existing overrides. Maintain a values schema for non-trivial charts. Preserve explicit `false` and `0` when applying defaults.
- For GitOps, render the same manifests from the same chart and values. Use chart-qualified helpers for resource names and selector labels so services target the intended workloads.
- Use existing Secrets or the platform's secret store. Keep plaintext credentials out of chart values and rendered test output.

## Upgrades and verification

- Preserve deployed workload selectors and persistent volume claims. Plan a migration before changing their identity or immutable fields. Plan CRD upgrades explicitly because Helm skips already-installed CRDs in `crds/`.
- Run `helm lint`. Use `helm template` with defaults and representative overrides, including feature toggles. Check the rendered diff for resource replacements, selector mismatches, and unexpected changes to existing installs.
- For changes to cluster APIs, hooks, or storage, run a server-side dry run or install and upgrade in a disposable cluster as appropriate. Test an upgrade from the previous release when lifecycle behavior changes.
