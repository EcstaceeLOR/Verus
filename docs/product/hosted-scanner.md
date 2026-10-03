# Hosted scanner experience

The hosted Verus console is the quickest way to inspect text before a trading agent consumes it. It
is intentionally a single-purpose flow: provide untrusted context, run the deterministic inspection,
and act on an `allow`, `review`, or `block` decision.

## User flow

1. Open **Scanner** and paste market commentary, research, a social post, or retrieved web text.
2. Select **Inspect context**. The public endpoint processes at most 64 KB in memory.
3. Follow the displayed decision:
   - **Allow** means no configured manipulation rule matched. It is not a factuality guarantee.
   - **Review** means automation must pause for human judgment.
   - **Block** means the input must not be passed to a trading agent.
4. Expand **Technical evidence** only when a digest, ruleset version, or scan identifier is needed.

The safe and attack examples exercise the real hosted scan endpoint; they are not canned verdicts.

## Security and privacy boundaries

- The hosted scanner does not request exchange credentials and cannot trade or move funds.
- Submitted text is processed in memory and is not written to browser history. Local history stores
  decision metadata only.
- Findings render controlled labels and locations, never submitted text or active HTML.
- Service unavailability is explicit. The console never treats a failed inspection as an allow.

## UI maintenance

Product language and decision guidance live in `apps/console/src/scan-workflow.ts` and are covered
by unit tests. Shared visual tokens and responsive behavior live in `apps/console/src/styles.css`.
The logo is a native SVG component and favicon, so it requires no external font, image, or tracking
request.

This release changes no persisted server state and requires no migration. Rollback is the previous
static console deployment; scan API compatibility is unchanged.
