# web-e2e-qa

> **Moved.** This project now lives in [app-quality-lab/web-e2e-qa](https://github.com/su0xpj-bastion/app-quality-lab/tree/main/web-e2e-qa), where it is maintained and tested. This repository is archived and read-only.

End-to-end QA for a streaming AI-answer web app, in **TypeScript + Playwright**: the same suite runs on **Chromium, Firefox and WebKit**, on desktop, phone and tablet viewports, and checks what you would otherwise check by hand in DevTools: console errors, the network panel, and performance timings. Every test has a deliberately injected UI bug it must catch, and a script proves it.

The app under test, **Answerly** (`app/`), is small but has the parts that break in real AI products: answers streamed over Server-Sent Events, numbered citations, follow-up questions in a thread, Stop / Regenerate / Try again, share links, history and deep links, and sign-in with session expiry.

```bash
npm ci && npx playwright install chromium firefox webkit
npx playwright test                         # 7 projects, the app starts automatically
npx playwright test --project=firefox-desktop
npm run faults                              # inject each bug, confirm exactly its tests fail
npm run app                                 # http://127.0.0.1:4173  (ada@example.test / correct-horse-test)
```

## Coverage

| Spec | What it proves |
|---|---|
| `answer.spec.ts` | the answer really streams (≥ 4 partial states seen); every citation `[n]` links to source *n*; a follow-up stays in the thread and uses the earlier question; Enter + click sends **one** request; questions and answers are rendered as text, never HTML (an `<img onerror>` payload) |
| `controls.spec.ts` | Stop freezes the answer; Regenerate replaces instead of appending; a stream that breaks mid-answer shows an error and Try again yields one clean answer (the break is injected with `page.route`); a share link is read-only for a signed-out visitor |
| `auth.spec.ts` | wrong password; returning to a deep link after sign-in; an expired session keeps the question being typed; sign-out ends the session server-side; one user can't open another's thread |
| `navigation.spec.ts` | a thread survives reload and appears in History; back / forward work without a full page reload; unknown ids show a not-found page |
| `responsive.spec.ts` | no horizontal scrolling; navigation reachable at every width (collapsed menu on phones, `aria-expanded` kept in sync); 44 px touch targets; the input stays reachable |
| `a11y.spec.ts` | axe-core, WCAG 2.1 AA, no serious or critical violations on four page states; the keyboard-only flow, including the skip link; the streaming answer is a polite live region marked `aria-busy` |
| `devtools.spec.ts` | **Network:** `text/event-stream` + `no-cache`, no failed (≥ 400) or off-site requests. **Performance:** DOMContentLoaded < 1.5 s, LCP < 2.5 s (Chromium), submit → first word on screen < 1 s via `performance.measure`. **Security headers:** CSP present, session cookie `HttpOnly` + `SameSite=Lax` |
| `visual.spec.ts` | screenshot comparison of the sign-in page and a finished answer against committed Linux baselines |
| auto fixture | **every** test fails on an unexpected console error or uncaught exception, with the errors attached to the report |

Projects: `chromium-desktop`, `firefox-desktop`, `webkit-desktop`, `mobile-chrome` (Pixel 7), `mobile-safari` (iPhone 14), `tablet` (iPad Mini), `visual`. Locally: **166 passed** (7 skipped by design, e.g. touch-target checks on desktop) across the six functional projects in about a minute. Traces, videos and screenshots are kept for every failure.

## The fault matrix

`APP_FAULTS=<name>` switches on one real-world bug. `scripts/fault-matrix.mjs` runs the suite once per fault (Chromium desktop + Pixel 7) and fails unless **exactly** the tests pinned in [`tests/faults.json`](tests/faults.json) fail, and a healthy app fails nothing.

| Fault | The bug | Caught by |
|---|---|---|
| `no_stream` | server buffers the whole answer | streaming test, Stop test |
| `citation_offbyone` | `[1]` links to source 2 | citation test |
| `double_submit` | no in-flight guard; Enter then a click sends twice | one-request test |
| `stop_ignored` | Stop changes the label, the text keeps coming | Stop test |
| `retry_duplicates` | Try again adds a second copy of the turn | broken-stream test |
| `xss_unescaped` | the question is rendered as HTML | text-not-HTML test |
| `share_leaks_controls` | a visitor of a share link gets an input box | share test |
| `session_expiry_loses_question` | sign-in after expiry drops the draft | expired-session test |
| `mobile_overflow` | a 720 px banner at every width | no-horizontal-scroll test (phone only) |
| `a11y_low_contrast` | secondary text below AA contrast | axe on the answer page |
| `slow_first_token` | 2.5 s before the first word | UI TTFT budget, streaming test |
| `wrong_content_type` | stream served as `text/plain` | network test |
| `console_error` | a script error after each answer | the console fixture, in every test that finishes an answer (19) |
| `midstream_error` | every first attempt breaks after 30 words | every test that needs a finished answer (18) |

The matrix earned its keep while it was being built: `citation_offbyone` first went **uncaught** (the bug was injected server-side, so link and source list moved together and stayed consistent), and so did `double_submit` (the parallel `Promise.all` in the test didn't reproduce the user's Enter-then-click). A third pin was timing-dependent (`midstream_error` broke the stream at word 12, racing the Stop test), so the break moved to word 30. Faults and tests were corrected until every run of the matrix gave the same answer.

## Real bugs the cross-browser run found

Both passed on Chromium and failed only in the Firefox project:

- [BUG-0001](docs/bugs/0001-firefox-skip-link-focus.md): the "Skip to content" link scrolled to the main content but left keyboard focus behind. Fixed by moving focus explicitly.
- [BUG-0002](docs/bugs/0002-firefox-unhandled-fetch-rejection.md): navigating away while a request was in flight raised an unhandled `NetworkError` rejection, about one run in five. Caught by the console-error fixture, reproduced with `--repeat-each=5`, fixed in the router, verified with 10 clean repeats.

Each write-up follows the [bug template](.github/ISSUE_TEMPLATE/bug.yml): severity, steps from a clean state, expected vs actual, environment, evidence, root cause and scope.

## CI

- **e2e:** typecheck, the six functional projects, then visual regression against Linux baselines. HTML report, traces and videos uploaded as artifacts.
- **fault-matrix:** every fault on Chromium + Pixel 7; the matrix table goes to the job summary.
- **update-visual-baselines** (manual): regenerates the Linux screenshots in CI and commits them, so baselines never come from a developer's laptop.

## Layout

```
app/server.mjs           Node HTTP server: auth, threads, shares, SSE answers, 14 faults (no dependencies)
app/public/              the client: plain ES modules, no framework
tests/e2e/fixtures.ts    console-error auto fixture, API sign-in, request log, helpers
tests/e2e/*.spec.ts      the specs above
tests/faults.json        fault -> tests that must fail
scripts/fault-matrix.mjs runs and checks the matrix
docs/TEST_PLAN.md        scope, browser/device matrix, entry/exit, flake policy
docs/bugs/               bug reports
```

## Where this stops

- The app is a purpose-built test target, not a production product, and the answers are canned. It exercises web behaviour (streaming, routing, auth, layout), not answer quality.
- WebKit here is Playwright's WebKit build, close to Safari but not Safari itself. Real-device checks on iOS hardware are out of scope.
- Performance budgets are for a local server; against a deployed environment they need re-baselining.
- `devtools.spec.ts` asserts on what DevTools would show. It doesn't replace profiling a real slowdown, which starts from the Playwright trace's network and timing data.
