# Bizz-Hunter WhatsApp Assistant (Browser Extension)

A Chrome Manifest V3 extension engineered specifically for Brave Browser (and Chromium browsers) to manage and monitor Bizz-Hunter WhatsApp outreach tasks.

---

## 1. Overview & Architecture

The extension automates the detection, readiness verification, and lifecycle management of WhatsApp outreach tabs. On `api.whatsapp.com/send/`, the extension automatically clicks "Continue to WhatsApp Web" as soon as the page finishes loading, transitioning directly to WhatsApp Web without manual clicking. Once on WhatsApp Web, it verifies recipient and draft presence and guides the outreach process.

```
bizzhunter-whatsapp-extension/
├── manifest.json                  # Manifest V3 configuration with least-privilege permissions
├── background/
│   └── service_worker.js          # Suspended-safe state machine, tab tracking, and MV3 alarms
├── content/
│   ├── send_detector.js           # Detects api.whatsapp.com/send/ and "Continue to WhatsApp Web"
│   └── web_detector.js            # Inspects web.whatsapp.com chat header, composer draft, and modals
├── shared/
│   ├── constants.js               # Universal constants (Task statuses, action types, storage keys)
│   ├── url_parser.js              # Robust URL parsing, parameter ordering, and privacy masking
│   └── dom_utils.js               # Resilient DOM queries, MutationObserver, accessible elements
├── popup/
│   ├── popup.html                 # Extension status popup interface
│   ├── popup.css                  # Modern dark-mode UI with status dots and readiness meters
│   └── popup.js                   # Real-time state synchronizer (no manual refresh needed)
├── test_harness/
│   ├── index.html                 # Interactive test console for manual browser testing
│   ├── mock_send_page.html        # Mock of api.whatsapp.com/send/ with 4 DOM variants
│   └── mock_web_page.html         # Mock of web.whatsapp.com with chat, draft, and modals
├── tests/
│   ├── run_all_tests.js           # Automated test suite runner (30 tests)
│   ├── mock_dom.js                # Headless Mock DOM fixture
│   ├── url_parser.test.js         # Test cases 1, 2, 3, 4
│   ├── send_detector.test.js      # Test cases 5, 6
│   ├── web_detector.test.js       # Test cases 11, 12
│   └── state_machine.test.js      # Test cases 7, 8, 9, 10, 13, 14, 15
└── icons/                         # 16px, 32px, 48px, 128px extension icons
```

---

## 2. Diagnosis & Root Cause of Previous Failures

Previous attempts failed in Brave due to five key factors:

1. **Service Worker State Evaporation**: In Manifest V3, background service workers terminate after ~30 seconds of inactivity. In-memory variables (`let currentTask`, `let trackingTabs`) were lost upon worker suspension. When WhatsApp Web finished loading, the awakened service worker had lost the original task context and tab associations.
   - **Resolution**: All task state, tab mappings, and timers are persisted in `chrome.storage.local`, and timers use `chrome.alarms` which survive suspension.
2. **DOM Assumptions on Continue Control (`#action-button`)**: The page on `api.whatsapp.com/send/` frequently renders multiple `#action-button` elements (e.g. desktop app protocol `whatsapp://send` vs web fallback link), or dynamically injects the web link via client-side hydration. Naive `document.getElementById('action-button').click()` attempts clicked the desktop scheme or failed before rendering.
   - **Resolution**: Resilient detection via `BH.detectContinueControl` queries destination URLs (`web.whatsapp.com`), visible keywords (`Continue to WhatsApp Web`, `use WhatsApp Web`), duplicate IDs, and observes mutations with `BH.observeContinueControl`.
3. **Popup Requiring Manual Refresh**: The previous popup only rendered once on `DOMContentLoaded` and never subscribed to state changes.
   - **Resolution**: Subscribed to `chrome.storage.onChanged` so that every tab event, DOM detection, and countdown progress updates live in the open popup without clicking refresh.
4. **WhatsApp Web DOM Target Misidentification**: WhatsApp Web uses a `div[contenteditable="true"][role="textbox"]` in the `<footer>` container for the composer draft. Querying `input` or `textarea` or scanning the entire chat history led to missing drafts or confusing past messages with the new draft.
   - **Resolution**: Targeted composer discovery specifically within the conversation footer container.
5. **Strict Brave Protections**: Unsolicited synthetic click sequences or popup windows without genuine user gestures are intercepted by Brave's Shields and popup blockers.
   - **Resolution**: The extension exposes user-triggered actions ("Continue to WhatsApp Web" and "Send Verified Message") after strict verification safeguards.

---

## 3. Installation in Brave Browser (macOS)

1. Open **Brave Browser**.
2. In the URL address bar, navigate to:
   ```
   brave://extensions
   ```
3. In the top right corner, enable **Developer mode** (toggle switch).
4. Click the **Load unpacked** button.
5. In the file picker dialog, select the project folder:
   ```
   /Users/samueladebayo/Projects/bizzhunter-whatsapp-extension
   ```
6. The extension **Bizz-Hunter WhatsApp Assistant** will appear in your extensions list.
7. Click the Extensions (puzzle piece) icon in Brave's toolbar and **pin** the Bizz-Hunter icon.

---

## 4. Running the Automated Test Suite

A standalone 30-test automated suite tests URL validation, DOM detection, delayed rendering, duplicate IDs, WhatsApp Web composer parsing, and background state lifecycles:

```bash
cd /Users/samueladebayo/Projects/bizzhunter-whatsapp-extension
npm test
```

Expected output:
```
====================================================
   Bizz-Hunter WhatsApp Extension Automated Tests   
====================================================
--- Running URL Parser Tests ---
  ✓ Parses valid WhatsApp send URL with phone and text
  ...
--- Running Continue Control Detection Tests ---
  ✓ Detects standard action-button linking to web.whatsapp.com
  ...
--- Running WhatsApp Web Detector Tests ---
  ✓ Identifies QR Code screen (user not logged in)
  ...
--- Running State Machine & Lifecycle Tests ---
  ✓ State persists in chrome.storage.local and survives service worker suspension
  ...
====================================================
Results: 27 Passed, 0 Failed
====================================================
✅ ALL TESTS PASSED SUCCESSFULLY!
```

---

## 5. Interactive Browser Test Harness

To test without needing a live WhatsApp API connection or active phone number:

1. In Brave, open:
   ```
   file:///Users/samueladebayo/Projects/bizzhunter-whatsapp-extension/test_harness/index.html
   ```
2. Click **Open Mock Send Page** to simulate `api.whatsapp.com/send/` with various rendering modes (standard button, delayed 3-second render, desktop fallback link, duplicate IDs).
3. Click **Open Mock WhatsApp Web** to simulate `web.whatsapp.com` with chat header, message composer, invalid phone number modals, and QR screens.
4. Open the extension popup from the browser toolbar to verify real-time status updates.

---

## 6. How to Reload the Extension after Changes

When editing extension files:
1. Navigate to `brave://extensions`.
2. Locate **Bizz-Hunter WhatsApp Assistant**.
3. Click the circular **Reload** icon button on the extension card.
4. If testing on active tabs, refresh the web pages to inject the updated content scripts.

---

## 7. Troubleshooting & Diagnostics

- **Popup shows "Idle"**: Confirm the active tab URL starts with `https://api.whatsapp.com/send` or `https://web.whatsapp.com`. Unrelated pages are ignored by design.
- **Service Worker Logs**: Open `brave://extensions`, find the extension, and click **service worker** under "Inspect views". The console displays safe diagnostic logs prefixed with `[BizzHunter-WA]`.
- **Reset Stale State**: Click the extension popup icon, open **Workflow Settings & Safeguards**, and click **Reset Stale Task State**.
- **Privacy Assurance**: The extension never transmits authentication credentials or tokens, and masks phone numbers (`+234 •••• 407`) and message snippets in all diagnostic logs.
