# BUG-0002: Navigating away mid-request throws an unhandled rejection in Firefox

| | |
|---|---|
| **Severity** | S3: no visible breakage, but it pollutes error monitoring and hides real errors |
| **Found by** | the console-error fixture, on `navigation.spec.ts › an unknown thread id…` in `firefox-desktop` (about 1 run in 5) |
| **Affected** | Firefox. Chromium and WebKit cancel the same requests silently |
| **Status** | Fixed in `app/public/app.js` |

## Steps to reproduce

1. Sign in and open `/` in Firefox.
2. Before the page finishes its `/api/me` request, navigate to another URL (the test does this with `page.goto`).

**Expected:** no errors.
**Actual:** `pageerror: NetworkError when attempting to fetch resource.`: the router's `fetch` rejects with a `TypeError` when the document is torn down, nothing catches it, and it surfaces as an uncaught rejection.

## Why it was intermittent

It only happens when navigation lands while a request is still in flight, so it depended on timing: it reproduced in about one of five repeated runs (`--repeat-each=5`), and never on Chromium.

## Fix

The router now treats a `TypeError` from `fetch` (network failure, or a request cancelled by navigation) as "can't reach the server" and renders a message instead of rethrowing. The startup config fetch got the same guard. Verified with `--repeat-each=10` on Firefox.
