# Release decision record

`go-no-go.v1.json` is the checked release decision. It starts as **no-go** deliberately: no code
change may self-approve an external security review or production-like staging drill.

To change it to `go`, named release, security, operations, and product owners must record the exact
40-character release commit, review timestamp, immutable SBOM/provenance artifact references, and
closure of every blocker. The verifier rejects a go record with unresolved blockers, anonymous
owners, a mutable revision, or missing artifacts.

Residual risks are not blockers only when their mitigation, named owner, and review date are
recorded in the private review system and accepted by the release and security owners. Never list
customer data, credentials, exploit details, or unredacted external-review findings in this public
record.
