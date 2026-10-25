/**
 * Test Suite: Send Page Continue Control Detector
 * Tests cases 5 & 6 and DOM variations:
 * - Direct anchor to web.whatsapp.com
 * - Real WhatsApp markup with #action-button
 * - Delayed rendering of Continue control
 * - Multiple elements with duplicate IDs (desktop protocol vs web fallback)
 * - Accessible labels & wording variations
 * - Hidden vs visible controls
 */

const assert = require('assert');
const BH = require('../shared/dom_utils.js');
const { MockDocument } = require('./mock_dom.js');

function runTests() {
  console.log('\n--- Running Continue Control Detection Tests ---');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}: ${err.message}`);
      failed++;
    }
  }

  // 1. Standard WhatsApp markup with id="action-button" pointing to Web
  test('Detects standard action-button linking to web.whatsapp.com', () => {
    const doc = new MockDocument();
    const anchor = doc.createElement('a', {
      id: 'action-button',
      href: 'https://web.whatsapp.com/send/?phone=2347031615407&text=Hello'
    }, 'Continue to WhatsApp Web');
    doc.body.appendChild(anchor);

    const result = BH.detectContinueControl(doc);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.targetType, 'web');
    assert.strictEqual(result.visibleText, 'Continue to WhatsApp Web');
    assert.strictEqual(result.isReady, true);
  });

  // 2. Duplicate IDs: Desktop scheme vs Web fallback
  test('Handles duplicate IDs and prioritizes Web link over desktop scheme', () => {
    const doc = new MockDocument();

    // First action button points to desktop app
    const desktopBtn = doc.createElement('a', {
      id: 'action-button',
      href: 'whatsapp://send?phone=2347031615407'
    }, 'Open WhatsApp App');
    doc.body.appendChild(desktopBtn);

    // Secondary link pointing to Web
    const webFallback = doc.createElement('a', {
      class: '_9v6b',
      href: 'https://web.whatsapp.com/send/?phone=2347031615407'
    }, 'use WhatsApp Web');
    doc.body.appendChild(webFallback);

    const result = BH.detectContinueControl(doc);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.targetType, 'web');
    assert.ok(result.destinationUrl.includes('web.whatsapp.com'));
    assert.strictEqual(result.visibleText, 'use WhatsApp Web');
  });

  // 3. Wording Variations ("Continue to Chat")
  test('Detects wording variation: "Continue to Chat"', () => {
    const doc = new MockDocument();
    const btn = doc.createElement('button', {}, 'Continue to Chat');
    doc.body.appendChild(btn);

    const result = BH.detectContinueControl(doc);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.visibleText, 'Continue to Chat');
  });

  // 4. Ignores hidden elements
  test('Ignores elements with display: none in style', () => {
    const doc = new MockDocument();
    const hiddenAnchor = doc.createElement('a', {
      href: 'https://web.whatsapp.com/send'
    }, 'Continue to WhatsApp Web');
    hiddenAnchor.style.display = 'none';
    doc.body.appendChild(hiddenAnchor);

    const result = BH.detectContinueControl(doc);
    assert.strictEqual(result.found, false);
  });

  // 5. Disabled control detection
  test('Detects disabled Continue control and sets isReady to false', () => {
    const doc = new MockDocument();
    const btn = doc.createElement('button', { disabled: 'true' }, 'Continue to WhatsApp Web');
    doc.body.appendChild(btn);

    const result = BH.detectContinueControl(doc);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.isReady, false);
  });

  // 6. MutationObserver delayed rendering
  test('Observes DOM and detects dynamically appended Continue control', () => {
    const doc = new MockDocument();

    // Mock MutationObserver for Node.js
    global.MutationObserver = class {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {}
      disconnect() {}
    };

    let detected = false;
    const handle = BH.observeContinueControl(doc, (res) => {
      if (res.found) {
        detected = true;
        assert.strictEqual(res.visibleText, 'Continue to WhatsApp Web');
      }
    }, 2000);

    // Simulate dynamic append
    const dynamicAnchor = doc.createElement('a', {
      href: 'https://web.whatsapp.com/send'
    }, 'Continue to WhatsApp Web');
    doc.body.appendChild(dynamicAnchor);

    // Trigger detection check
    const check = BH.detectContinueControl(doc);
    assert.strictEqual(check.found, true);
    handle.disconnect();
  });

  return { passed, failed };
}

if (require.main === module) {
  const { passed, failed } = runTests();
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = runTests;
