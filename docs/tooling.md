# Tooling

React Compiler runs through `apps/web/react.ts` in the web build, Vitest and Storybook.
Expo enables the same compiler in `apps/mobile/app.config.ts`.

## Screen tests and stories

`vp test run` includes the web's jsdom tests, the phone's React Native Testing Library tests,
and the web's portable Storybook stories. Story play functions contain the interaction assertions;
the Vitest test calls each composed story's `run()`. No browser server is needed for these tests.
Use Playwright for layout and journeys that need the real browser.

The phone's test uses an in-memory SQLite database behind expo-sqlite's async interface and a
fresh QueryClient. Native host stand-ins are in `apps/mobile/test/native`; they do not prove native
layout or platform behavior. Wait for the displayed result with `findByRole`, never a sleep.

`@app/contracts/testing` exports `fakeSyncApi`. Handlers use HttpApiBuilder and the derived
HttpApiTest client, so responses pass through the contract's encoding and decoding. Dispose the
helper after each test. The metadata endpoint is a stub until #52 adds the sync contract. Current
screens use local data and do not make sync requests; extend scenarios when sync reaches them.

- Web: `vp run --filter @app/web storybook` (port 6006).
- Static web build: `vp run --filter @app/web build-storybook`.
- Phone: `vp run --filter @app/mobile storybook`, then open an Android dev client. Metro swaps the
  entry point only with `STORYBOOK_ENABLED=true`. Normal bundles retain the app entry point.
- Phone bundle: `vp run --filter @app/mobile build-storybook` (no development server).
- Generate phone story imports before standalone type checks on a fresh checkout:
  `vp exec --filter @app/mobile sb-rn-get-stories`. Metro also generates them automatically.

## Violation ceilings

`vp run quality` collects oxlint, Fallow dead-code and duplicate instances, and React Doctor.
`scripts/tooling/baseline.json` records each tool's per-file allowance. An omitted file has zero
allowance. The initial baseline has zero oxlint/Fallow findings and one React Doctor finding in
shadcn's generated button, which exports its variants alongside the component.

Set `QUALITY_BASE` to a Git ref to reject every increased allowance relative to that ref. CI uses
the PR base commit or the previous push commit. The first introduction of the baseline establishes
its limits; subsequent changes may only lower them. Scanner failures and incomplete analysis fail
CI too. After fixing findings, `vp exec node scripts/tooling/quality.ts --snapshot` refreshes the
counts; review the diff and commit only reductions.

## CI selection

Pull requests select changed packages and their dependents with `...[origin/main]`. Shared root
configuration and tooling changes select the whole workspace. Main and version tags check all
packages. Tests select Vitest projects, including portable story tests when the web is selected.
Builds run only for selected apps. Fallow needs the complete import graph to find unused code;
its report is gated only for selected packages on a PR. React Doctor scans selected React apps.

Maestro runs on main and tags, and on PRs touching `apps/mobile/` or `modules/`. The workflow builds
a standalone APK and runs the collection smoke journey on an API 35 emulator. Alarm ringing,
lock-screen and OEM journeys still belong to the native feature tickets. The smoke flow skips
permission grants, completes onboarding, then creates a deck.
