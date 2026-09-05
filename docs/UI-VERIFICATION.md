# UI verification — 5 September 2026

Scope: the complete replacement of the earlier frontend in `apps/web`, the fixed fixture preview page, and the root DESIGN.md. React/Vite, Hugeicons, self-hosted Plus Jakarta Sans and shared semantic CSS tokens. Sources and pinned skills are recorded in [DESIGN-SOURCES.md](DESIGN-SOURCES.md).

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Seven axe audits; keyboard Escape/focus restoration; reduced motion; touch target; in-dialog conflict error | No remaining automated violations in the inspected states |
| Colors | Actual browser contrast pairs on login, board, review, publication and mobile navigation | Secondary labels corrected to exceed 4.5:1 on their soft surfaces |
| Layout | Desktop board/review screenshots, 390px board, 320px review, 720px reflow | Controls remain reachable without horizontal overflow |
| Typography | Rendered self-hosted font and shared scale | Secondary text raised to a 12px floor; title hierarchy retained |
| UI | Board, sidebar, composer, task/review/approval states and raised button capture | Fresh soft palette, aligned columns and consistent controls |
| Writing | Scope, review actions, fixture labels, errors and advanced disclosures | Publication and merge remain distinct; external simulations are disclosed |
| Motion | Pointer transitions in CSS, reduced-motion browser assertion | Short drawer/dialog/sidebar entry, pressed buttons and 1px card lift; no looping decorative motion |

Corrections made during implementation:

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Accessibility | Shared secondary text token | 4.4:1 on muted surfaces | Darker neutral `#686572` | Normal text must reach 4.5:1 |
| HIGH | Accessibility | Task and approval dialogs | Errors could appear behind the modal | Inline errors in the active dialog | The person must see and recover from a rejected command |
| MEDIUM | Typography | Shared caption scale | Some 9–11px labels | 12px minimum | Improve readability without adding copy |

Executed checks:

- `bun run build`: TypeScript and Vite passed.
- `bun run design:lint`: zero errors and warnings with Google's 0.4.0 linter.
- `TMPDIR="$PWD/.local/tmp" bun run test:browser`: real Chromium journey passed against built application and private Postgres. Sign-in, exclusive start, preview on separate origin, correction, publication approval, separate merge, task creation and feedback. Also checked mobile navigation, focus restoration, reduced motion, touch target and a repository-concurrency error inside the review dialog.
- Seven axe audits: sign-in, review, publication confirmation, desktop board, mobile board, mobile navigation and mobile review. Zero violations in the selected WCAG A/AA rules. Audits wait for entry transitions to settle before measuring contrast.
- `bun test`: 30 tests passed, including Postgres ownership/recovery and three mocked integration-contract tests.

Rendered artifacts are generated locally under `.local/screenshots`: `board-desktop.png`, `board-mobile.png`, `task-review.png`, `review-mobile-320.png` and `raised-button.png`. They were inspected; screenshot capture is not a pixel regression assertion.

Not verified: native browser zoom (720px reflow was checked instead), screen-reader operation, other browser engines, real cloud execution, real repository previews, live GitHub/Neon and provider billing. No unresolved high-severity interface finding was identified in this inspected fixture scope. This is not production-readiness approval.
