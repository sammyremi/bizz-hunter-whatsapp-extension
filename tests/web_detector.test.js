/**
 * Test Suite: WhatsApp Web Detector
 * Tests cases 11 & 12:
 * - Detecting active chat vs loading state
 * - Detecting QR code / not logged in screen
 * - Detecting invalid phone number modal
 * - Header recipient extraction and phone verification
 * - Message composer draft extraction
 * - Distinguishing draft from message bubbles in conversation history
 * - Missing draft handling
 */

const assert = require('assert');
const BH = require('../shared/dom_utils.js');
const { MockDocument } = require('./mock_dom.js');

function runTests() {
  console.log('\n--- Running WhatsApp Web Detector Tests ---');
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

  // 1. QR Code Screen
  test('Identifies QR Code screen (user not logged in)', () => {
    const doc = new MockDocument();
    const qrCanvas = doc.createElement('canvas', { 'aria-label': 'Scan this QR code with WhatsApp on your phone' });
    doc.body.appendChild(qrCanvas);

    const res = BH.inspectWhatsAppWeb(doc);
    assert.strictEqual(res.isQrScreen, true);
    assert.strictEqual(res.chatOpen, false);
  });

  // 2. Invalid Phone Number Modal
  test('Identifies invalid phone number popup modal', () => {
    const doc = new MockDocument();
    const modal = doc.createElement('div', {
      'role': 'dialog',
      'data-animate-modal-popup': 'true'
    }, 'Phone number shared via url is invalid.');
    doc.body.appendChild(modal);

    const res = BH.inspectWhatsAppWeb(doc);
    assert.strictEqual(res.isInvalidNumber, true);
    assert.match(res.invalidNumberMessage, /invalid/i);
  });

  // 3. Active Chat with Header Recipient and Composer Draft
  test('Identifies active chat, recipient in header, and draft in footer composer', () => {
    const doc = new MockDocument();

    const app = doc.createElement('div', { id: 'app' });
    doc.body.appendChild(app);

    const main = doc.createElement('div', { id: 'main' });
    app.appendChild(main);

    // Header with recipient
    const header = doc.createElement('header');
    const titleSpan = doc.createElement('span', { title: '+234 703 161 5407' }, '+234 703 161 5407');
    header.appendChild(titleSpan);
    main.appendChild(header);

    // Footer with composer
    const footer = doc.createElement('footer');
    const composer = doc.createElement('div', {
      contenteditable: 'true',
      role: 'textbox',
      'data-tab': '10'
    }, 'Hi, I saw your listing on Google Maps and wanted to reach out.');
    footer.appendChild(composer);

    // Send button in footer
    const sendBtn = doc.createElement('button', { 'data-testid': 'compose-btn-send' }, 'Send');
    footer.appendChild(sendBtn);

    main.appendChild(footer);

    const res = BH.inspectWhatsAppWeb(doc, '2347031615407');
    assert.strictEqual(res.isAppLoaded, true);
    assert.strictEqual(res.chatOpen, true);
    assert.strictEqual(res.recipientText, '+234 703 161 5407');
    assert.strictEqual(res.recipientVerified, true);
    assert.strictEqual(res.composerFound, true);
    assert.strictEqual(res.hasDraft, true);
    assert.match(res.draftText, /Hi, I saw your listing/);
    assert.strictEqual(res.sendButtonFound, true);
  });

  // 4. Distinguishes composer draft from message history bubbles
  test('Does not mistake messages in conversation history for active draft', () => {
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);

    // Header
    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: '+14155552671' }, '+14155552671'));
    main.appendChild(header);

    // Message history container with past messages
    const messageHistory = doc.createElement('div', { 'data-testid': 'conversation-panel-messages' });
    const pastBubble = doc.createElement('div', { class: 'message-in' }, 'Previous conversation text from yesterday');
    messageHistory.appendChild(pastBubble);
    main.appendChild(messageHistory);

    // Footer with EMPTY composer
    const footer = doc.createElement('footer');
    const emptyComposer = doc.createElement('div', {
      contenteditable: 'true',
      role: 'textbox'
    }, '');
    footer.appendChild(emptyComposer);
    main.appendChild(footer);

    const res = BH.inspectWhatsAppWeb(doc, '14155552671');
    assert.strictEqual(res.chatOpen, true);
    assert.strictEqual(res.composerFound, true);
    assert.strictEqual(res.hasDraft, false);
    assert.strictEqual(res.draftText, '');
  });

  // 5. Mismatched Recipient Detection
  test('Detects mismatched recipient phone number', () => {
    const doc = new MockDocument();
    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: '+44 7911 123456' }, '+44 7911 123456'));
    doc.body.appendChild(header);

    const footer = doc.createElement('footer');
    footer.appendChild(doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, 'Hello'));
    doc.body.appendChild(footer);

    // Expected is Nigerian number 2347031615407, but header has UK number 447911123456
    const res = BH.inspectWhatsAppWeb(doc, '2347031615407');
    assert.strictEqual(res.chatOpen, true);
    assert.strictEqual(res.recipientVerified, false);
  });

  // 6. Direct Message Injection into Empty Chat Box
  test('Directly populates draft into empty composer when chat opens', () => {
    const doc = new MockDocument();
    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: '+234 703 161 5407' }, '+234 703 161 5407'));
    doc.body.appendChild(header);

    const footer = doc.createElement('footer');
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, '');
    footer.appendChild(composer);
    doc.body.appendChild(footer);

    // Initial inspection shows no draft
    const before = BH.inspectWhatsAppWeb(doc, '2347031615407');
    assert.strictEqual(before.hasDraft, false);

    // Inject message directly into composer
    const expectedMessage = 'Hello, this is a personalized outreach message.';
    composer.textContent = expectedMessage;
    composer.innerText = expectedMessage;

    // After inspection confirms draft is now directly open in composer
    const after = BH.inspectWhatsAppWeb(doc, '2347031615407');
    assert.strictEqual(after.hasDraft, true);
    assert.strictEqual(after.draftText, expectedMessage);
  });

  return { passed, failed };
}

if (require.main === module) {
  const { passed, failed } = runTests();
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = runTests;
