# Test plan: Answerly web app

## Scope

The signed-in ask flow (question → streamed answer with citations → follow-ups), stop / regenerate / retry,
sharing, history and deep links, sign-in and session expiry, across browsers and screen sizes.
Out of scope: answer quality (a model concern, not a web concern), load testing, payments.

## Matrix

| Project | Engine | Viewport | Why |
|---|---|---|---|
| chromium-desktop | Chromium | 1280×720 | most users; LCP is only exposed here |
| firefox-desktop | Gecko | 1280×720 | focus and fragment behaviour differ (see BUG-0001) |
| webkit-desktop | WebKit | 1280×720 | Safari's engine; Tab skips links by default |
| mobile-chrome | Chromium | Pixel 7 | touch, narrow layout, collapsed nav |
| mobile-safari | WebKit | iPhone 14 | iOS rendering and touch |
| tablet | WebKit | iPad Mini | the in-between breakpoint (wide nav, touch input) |
| visual | Chromium | 1280×800, light | screenshot comparison against Linux baselines |

## What each spec owns

| Spec | Risk it covers |
|---|---|
| `answer.spec.ts` | streaming really streams; citations point at the right source; follow-ups keep context; one request per submit; untrusted text never rendered as HTML |
| `controls.spec.ts` | Stop stops the stream; Regenerate replaces; a broken stream recovers to one clean answer; share links are read-only for visitors |
| `auth.spec.ts` | wrong password; deep-link return; expired session keeps the draft; sign-out; users can't open each other's threads |
| `navigation.spec.ts` | reload and History; back/forward without a full reload; unknown ids |
| `responsive.spec.ts` | no horizontal scroll; nav reachable at every width; 44 px touch targets; input stays reachable |
| `a11y.spec.ts` | axe (WCAG 2.1 AA, serious + critical) on four states; keyboard-only flow; live region for the streaming answer |
| `devtools.spec.ts` | Network: SSE content type, no failed or off-site requests. Performance: DOMContentLoaded, LCP, submit → first word. Headers: CSP, HttpOnly + SameSite cookie |
| fixture `consoleErrors` | every test fails on an unexpected console error or uncaught exception |

## Entry and exit

- **Entry:** the app starts and `/app-config.json` responds (Playwright `webServer`).
- **Exit for a release:** all six functional projects green, visual green or diffs reviewed, fault matrix green (every injected fault caught by exactly its tests, healthy app fails nothing).

## Flake policy

One retry in CI. A test that passes on retry is reported as flaky in the HTML report and gets an issue; it is not
re-run until green. Waits are on state (`aria-busy`, status text), never fixed sleeps, except where a test proves
that *nothing* happens for a period (Stop, empty submit).

## Bug reports

Use `.github/ISSUE_TEMPLATE/bug.yml`: severity, numbered steps from a clean state, expected vs actual, environment,
evidence (trace, HAR, console), and a root-cause hypothesis with affected / unaffected browsers. Example: `docs/bugs/0001-firefox-skip-link-focus.md`.
