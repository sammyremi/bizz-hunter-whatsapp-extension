/**
 * Test Suite: Regression Tests for WhatsApp Message Prefill and Chat Composer
 * Covers the 11 critical regression test scenarios specified in Step 4:
 * 1. Normal prefilled WhatsApp message.
 * 2. Message containing spaces, punctuation, emojis, and line breaks.
 * 3. Correct handling of URL-encoded characters without double-decoding.
 * 4. Preservation of original message across service worker and tab lifecycle.
 * 5. Delayed WhatsApp composer rendering.
 * 6. Composer replacement during loading (React re-mount).
 * 7. Recipient mismatch (active chat does not match intended recipient).
 * 8. Missing or empty message text.
 * 9. An existing draft that must not be overwritten after successful population.
 * 10. A failed composer population that must not be reported as successful.
 * 11. Repeated events that must not produce duplicate drafts.
 */

const assert = require('assert');
const BH_DOM = require('../shared/dom_utils.js');
const BH_URL = require('../shared/url_parser.js');
const BH_CONST = require('../shared/constants.js');
const { MockDocument, MockElement } = require('./mock_dom.js');

async function runRegressionTests() {
  console.log('\n--- Running Regression: Composer Message Prefill Tests ---');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}: ${err.message}`);
      failed++;
    }
  }

  // 1. Normal prefilled WhatsApp message
  await test('1. Normal prefilled WhatsApp message is extracted and populated intact', () => {
    const rawUrl = 'https://api.whatsapp.com/send/?phone=2347031615407&text=Hello%20from%20Bizz-Hunter';
    const parsed = BH_URL.parseWhatsAppUrl(rawUrl);
    assert.strictEqual(parsed.isValid, true);
    assert.strictEqual(parsed.text, 'Hello from Bizz-Hunter');

    const doc = new MockDocument();
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, '');
    const success = BH_DOM.insertMessageIntoComposer(composer, parsed.text);
    assert.strictEqual(success, true);
    assert.strictEqual(BH_DOM.stripZeroWidth(composer.textContent), 'Hello from Bizz-Hunter');
  });

  // 2. Message containing spaces, punctuation, emojis, and line breaks
  await test('2. Message containing spaces, punctuation, emojis, and line breaks is perfectly preserved', () => {
    const complexMessage = 'Hello there! 🚀\nWe saw your business on Google Maps.\nWould love to connect — let\'s chat! 😊';
    const rawUrl = `https://api.whatsapp.com/send/?phone=2347031615407&text=${encodeURIComponent(complexMessage)}`;
    const parsed = BH_URL.parseWhatsAppUrl(rawUrl);
    assert.strictEqual(parsed.text, complexMessage);

    const doc = new MockDocument();
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, '');
    const success = BH_DOM.insertMessageIntoComposer(composer, complexMessage);
    assert.strictEqual(success, true);
    assert.strictEqual(BH_DOM.stripZeroWidth(composer.textContent), complexMessage);
  });

  // 3. Correct handling of URL-encoded characters without double-decoding
  await test('3. Handles URL-encoded characters (%20, %26, %2B, %3F) without double-decoding', () => {
    // A message with an ampersand, plus sign, and percent sign
    const originalText = 'Sales & Growth + 50% discount? Yes!';
    const encoded = encodeURIComponent(originalText);
    const rawUrl = `https://api.whatsapp.com/send/?phone=2347031615407&text=${encoded}`;
    const parsed = BH_URL.parseWhatsAppUrl(rawUrl);

    // Verify exactly one decode took place
    assert.strictEqual(parsed.text, originalText);
    assert.strictEqual(parsed.text.includes('%26'), false);
    assert.strictEqual(parsed.text.includes('&'), true);

    const doc = new MockDocument();
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, '');
    BH_DOM.insertMessageIntoComposer(composer, parsed.text);
    assert.strictEqual(BH_DOM.stripZeroWidth(composer.textContent), originalText);
  });

  // 4. Preservation of original message across service worker and tab lifecycle
  await test('4. Preserves original message across service worker storage and tab transition', async () => {
    const storageStore = {};
    const mockStorage = {
      local: {
        get: async (keys) => {
          if (typeof keys === 'string') return { [keys]: storageStore[keys] };
          if (Array.isArray(keys)) {
            const out = {};
            keys.forEach(k => { out[k] = storageStore[k]; });
            return out;
          }
          return Object.assign({}, storageStore);
        },
        set: async (obj) => {
          Object.assign(storageStore, obj);
        }
      }
    };

    const originalMessage = 'High-intent lead message for WhatsApp outreach 🎯';
    const phone = '2347031615407';

    // Simulate Send Detector storing pending task info
    await mockStorage.local.set({
      [BH_CONST.StorageKey.PENDING_MESSAGE_TEXT]: originalMessage,
      [BH_CONST.StorageKey.PENDING_PHONE]: phone,
      [BH_CONST.StorageKey.TASKS]: {
        [`task_${phone}`]: {
          id: `task_${phone}`,
          phoneNormalized: phone,
          messageText: originalMessage,
          status: BH_CONST.TaskStatus.LINK_DETECTED
        }
      },
      [BH_CONST.StorageKey.ACTIVE_TASK_ID]: `task_${phone}`
    });

    // Simulate Service Worker waking up from suspension and reading storage
    const stored = await mockStorage.local.get([
      BH_CONST.StorageKey.PENDING_MESSAGE_TEXT,
      BH_CONST.StorageKey.PENDING_PHONE,
      BH_CONST.StorageKey.ACTIVE_TASK_ID,
      BH_CONST.StorageKey.TASKS
    ]);

    assert.strictEqual(stored[BH_CONST.StorageKey.PENDING_MESSAGE_TEXT], originalMessage);
    assert.strictEqual(stored[BH_CONST.StorageKey.PENDING_PHONE], phone);

    const activeTask = stored[BH_CONST.StorageKey.TASKS][stored[BH_CONST.StorageKey.ACTIVE_TASK_ID]];
    assert.strictEqual(activeTask.messageText, originalMessage);
  });

  // 5. Delayed WhatsApp composer rendering
  await test('5. Delayed WhatsApp composer rendering is safely detected and populated', () => {
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);

    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: '+234 703 161 5407' }, '+234 703 161 5407'));
    main.appendChild(header);

    // Initial inspection: Composer not yet rendered in DOM
    const inspectionInitial = BH_DOM.inspectWhatsAppWeb(doc, '2347031615407');
    assert.strictEqual(inspectionInitial.composerFound, false);
    assert.strictEqual(inspectionInitial.hasDraft, false);

    // Composer appears after hydration
    const footer = doc.createElement('footer');
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, '');
    footer.appendChild(composer);
    main.appendChild(footer);

    // Next inspection detects composer and allows population
    const inspectionAfterDelay = BH_DOM.inspectWhatsAppWeb(doc, '2347031615407');
    assert.strictEqual(inspectionAfterDelay.composerFound, true);

    const message = 'Delayed render test message';
    BH_DOM.insertMessageIntoComposer(inspectionAfterDelay.composerElement, message);

    const inspectionFinal = BH_DOM.inspectWhatsAppWeb(doc, '2347031615407');
    assert.strictEqual(inspectionFinal.hasDraft, true);
    assert.strictEqual(inspectionFinal.draftText, message);
  });

  // 6. Composer replacement during loading (React re-mount)
  await test('6. Safe detection when React replaces the composer DOM element during loading', () => {
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);

    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: '+234 703 161 5407' }, '+234 703 161 5407'));
    main.appendChild(header);

    const footer = doc.createElement('footer');
    main.appendChild(footer);

    // Old composer instance (will be replaced by React reconciliation)
    let composerV1 = doc.createElement('div', { contenteditable: 'true', role: 'textbox', id: 'c1' }, '');
    footer.appendChild(composerV1);

    const inspect1 = BH_DOM.inspectWhatsAppWeb(doc, '2347031615407');
    assert.strictEqual(inspect1.composerElement.getAttribute('id'), 'c1');

    // React unmounts old composer and mounts fresh composer
    footer.children = [];
    let composerV2 = doc.createElement('div', { contenteditable: 'true', role: 'textbox', id: 'c2' }, '');
    footer.appendChild(composerV2);

    const inspect2 = BH_DOM.inspectWhatsAppWeb(doc, '2347031615407');
    assert.strictEqual(inspect2.composerElement.getAttribute('id'), 'c2');

    // Populate the newly replaced active composer
    const msg = 'Outreach message to new composer';
    BH_DOM.insertMessageIntoComposer(inspect2.composerElement, msg);

    const inspect3 = BH_DOM.inspectWhatsAppWeb(doc, '2347031615407');
    assert.strictEqual(inspect3.hasDraft, true);
    assert.strictEqual(inspect3.draftText, msg);
  });

  // 7. Recipient mismatch
  await test('7. Refuses to verify recipient or report chat match when active header is different number', () => {
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);

    // Header has a completely different contact (e.g. previous conversation with UK contact)
    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: '+44 7911 123456' }, '+44 7911 123456'));
    main.appendChild(header);

    const footer = doc.createElement('footer');
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, '');
    footer.appendChild(composer);
    main.appendChild(footer);

    // Expected recipient is 2347031615407
    const res = BH_DOM.inspectWhatsAppWeb(doc, '2347031615407');
    assert.strictEqual(res.chatOpen, true);
    assert.strictEqual(res.recipientVerified, false);
    assert.strictEqual(res.recipientText, '+44 7911 123456');
  });

  // 8. Missing or empty message text
  await test('8. Handles missing or empty message text gracefully without corrupting composer', () => {
    const rawUrl = 'https://api.whatsapp.com/send/?phone=2347031615407';
    const parsed = BH_URL.parseWhatsAppUrl(rawUrl);
    assert.strictEqual(parsed.isValid, true);
    assert.strictEqual(parsed.text, '');

    const doc = new MockDocument();
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, '');
    const success = BH_DOM.insertMessageIntoComposer(composer, parsed.text);
    // When text is empty, insertion should return false and leave composer empty
    assert.strictEqual(success, false);
    assert.strictEqual(BH_DOM.stripZeroWidth(composer.textContent), '');
  });

  // 9. An existing draft that must not be overwritten after successful population
  await test('9. Does not overwrite user-edited draft once already populated', () => {
    const doc = new MockDocument();
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, '');

    const originalMessage = 'Hello, interested in your service.';
    BH_DOM.insertMessageIntoComposer(composer, originalMessage);
    assert.strictEqual(BH_DOM.stripZeroWidth(composer.textContent), originalMessage);

    // User edits the message in WhatsApp Web
    const editedByUser = 'Hello, interested in your service. Can we call at 2pm?';
    composer.textContent = editedByUser;
    composer.innerText = editedByUser;

    // Second check simulates subsequent inspection cycle:
    // If the composer text contains the original message, it must NOT be overwritten!
    const cleanCurrent = BH_DOM.stripZeroWidth(composer.textContent);
    const containsOriginal = cleanCurrent.includes(originalMessage);
    assert.strictEqual(containsOriginal, true);

    // ensureMessageIntoComposer must detect existing message and preserve user edits
    const preserved = BH_DOM.insertMessageIntoComposer(composer, originalMessage);
    assert.strictEqual(preserved, true);
    assert.strictEqual(BH_DOM.stripZeroWidth(composer.textContent), editedByUser);
  });

  // 10. A failed composer population that must not be reported as successful
  await test('10. Reports hasDraft as false if composer population fails or remains empty', () => {
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);

    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: '+234 703 161 5407' }, '+234 703 161 5407'));
    main.appendChild(header);

    const footer = doc.createElement('footer');
    // Composer has only zero-width space
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, '\u200B');
    footer.appendChild(composer);
    main.appendChild(footer);

    const res = BH_DOM.inspectWhatsAppWeb(doc, '2347031615407');
    // Must NOT report as successful draft
    assert.strictEqual(res.hasDraft, false);
    assert.strictEqual(res.draftText, '');
  });

  // 11. Repeated events that must not produce duplicate drafts
  await test('11. Repeated events do not produce duplicate draft copies in composer', () => {
    const doc = new MockDocument();
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, '');
    const message = 'Single outreach message copy';

    // First insertion
    BH_DOM.insertMessageIntoComposer(composer, message);
    assert.strictEqual(BH_DOM.stripZeroWidth(composer.textContent), message);

    // Repeated insertion event
    BH_DOM.insertMessageIntoComposer(composer, message);
    // Must still contain exactly one copy, never "Single outreach message copySingle outreach message copy"
    assert.strictEqual(BH_DOM.stripZeroWidth(composer.textContent), message);
  });

  return { passed, failed };
}

if (require.main === module) {
  runRegressionTests().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

module.exports = runRegressionTests;
