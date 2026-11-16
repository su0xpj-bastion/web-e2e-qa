# BUG-0001: "Skip to content" doesn't move keyboard focus in Firefox

| | |
|---|---|
| **Severity** | S2: keyboard and screen-reader users can't bypass the header; workaround is tabbing through it |
| **Found by** | `a11y.spec.ts › the whole ask flow works from the keyboard` on `firefox-desktop` |
| **Affected** | Firefox desktop. Not Chromium. WebKit skips links on Tab by default, so the flow isn't reachable there either way |
| **Status** | Fixed in `app/public/app.js` |

## Steps to reproduce

1. Sign in and open `/` in Firefox.
2. Focus the "Answerly" header link, then press Shift+Tab: the skip link appears.
3. Press Enter.

**Expected:** focus moves to `<main id="main" tabindex="-1">`, so the next Tab reaches the question box.
**Actual:** the page scrolls to `#main`, but `document.activeElement` is still the skip link. Chromium moves focus; Firefox doesn't.

## Evidence

```
Locator:  locator('main')
Expected: focused
Received: inactive
```
Playwright trace and video attached to the CI run.

## Root cause

The skip link relied on fragment navigation (`href="#main"`) to move focus. Browsers differ: following a fragment always scrolls, but only some move keyboard focus to a `tabindex="-1"` target.

## Fix

Handle the click and call `main.focus()` explicitly, which behaves the same in every engine. The test now passes on chromium-desktop, firefox-desktop and tablet.

## Why the test didn't catch it on the first browser

It passed on Chromium. Only the cross-browser run showed the difference, which is the reason the suite runs every functional test on three engines and not only on Chromium.
