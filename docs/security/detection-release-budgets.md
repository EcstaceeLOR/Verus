# Detection Release Budgets

The frozen v1 corpus is evaluated from a clean checkout by `corepack pnpm verify`. It reports
deterministic and model-assisted results separately; the provider-free baseline has no model result.
Blocking thresholds live in `corpus/v1/release-thresholds.v1.json`. Lowering any threshold requires
a reviewed, recorded policy change because the manifest has `approval_required_to_lower: true`.

The corpus verifier and regression suite cover multilingual, encoded, hidden-content, direct and
indirect instruction, tool-coercion, source-impersonation, benign, and adaptive mutation variants.
