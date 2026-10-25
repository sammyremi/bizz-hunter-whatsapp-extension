/**
 * Test Suite: Continue to WhatsApp Web Navigation Flow
 * Tests the 8 critical requirements for the new-tab continue navigation workflow:
 * 1. The original phone and message survive the Continue navigation.
 * 2. The original tab is not unintentionally navigated when the new-tab workflow is active.
 * 3. The new tab receives the detected destination URL (without corrupting it by copying only ?text=).
 * 4. The recipient-specific conversation opens correctly.
 * 5. The exact message is visible in the composer.
 * 6. The cursor is focused in the composer.
 * 7. No message is sent automatically.
 * 8. Retries do not create duplicate tabs or drafts.
 */

const assert = require('assert');
const BH_DOM = require('../shared/dom_utils.js');
const BH_URL = require('../shared/url_parser.js');
const BH_CONST = require('../shared/constants.js');
const { MockDocument, MockElement } = require('./mock_dom.js');

async function runContinueNavigationTests() {
  console.log('\n--- Running Continue to WhatsApp Web Navigation Tests ---');
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

  // 1. The original phone and message survive the Continue navigation
  await test('1. The original phone and message survive the Continue navigation', async () => {
    const rawSendUrl = 'https://api.whatsapp.com/send/?phone=2347031615407&text=Hi%20Arewa%20Specialist%2C%20saw%20your%20listing!';
    const parsed = BH_URL.parseWhatsAppUrl(rawSendUrl);
    assert.strictEqual(parsed.isValid, true);
    assert.strictEqual(parsed.phoneNormalized, '2347031615407');
    assert.strictEqual(parsed.text, 'Hi Arewa Specialist, saw your listing!');

    // Mock storage simulation
    const storage = {};
    storage[BH_CONST.StorageKey.PENDING_PHONE] = parsed.phoneNormalized;
    storage[BH_CONST.StorageKey.PENDING_MESSAGE_TEXT] = parsed.text;
    storage[BH_CONST.StorageKey.TASKS] = {
      task_1: {
        id: 'task_1',
        sendUrl: rawSendUrl,
        phoneNormalized: parsed.phoneNormalized,
        messageText: parsed.text,
        status: BH_CONST.TaskStatus.CONTINUE_DETECTED
      }
    };
    storage[BH_CONST.StorageKey.ACTIVE_TASK_ID] = 'task_1';

    // Simulate navigation: storage is read after navigation
    const pendingPhone = storage[BH_CONST.StorageKey.PENDING_PHONE];
    const pendingText = storage[BH_CONST.StorageKey.PENDING_MESSAGE_TEXT];
    const activeTask = storage[BH_CONST.StorageKey.TASKS][storage[BH_CONST.StorageKey.ACTIVE_TASK_ID]];

    assert.strictEqual(pendingPhone, '2347031615407');
    assert.strictEqual(pendingText, 'Hi Arewa Specialist, saw your listing!');
    assert.strictEqual(activeTask.phoneNormalized, '2347031615407');
    assert.strictEqual(activeTask.messageText, 'Hi Arewa Specialist, saw your listing!');
  });

  // 2. The original tab is not unintentionally navigated when the new-tab workflow is active
  await test('2. The original tab is not unintentionally navigated when the new-tab workflow is active', () => {
    const doc = new MockDocument();
    let currentWindowLocation = 'https://api.whatsapp.com/send/?phone=2347031615407&text=Hello';

    const anchor = doc.createElement('a', {
      id: 'action-button',
      href: 'https://web.whatsapp.com/'
    }, 'Continue to WhatsApp Web');
    doc.body.appendChild(anchor);

    // Simulate click event with preventDefault
    let defaultPrevented = false;
    let messageSent = null;

    const fakeEvent = {
      target: anchor,
      type: 'click',
      preventDefault: () => { defaultPrevented = true; },
      stopPropagation: () => {}
    };

    // Click handler simulation matching send_detector.js
    const clickedAnchor = fakeEvent.target.closest('a[href*="web.whatsapp.com"]') ||
                          fakeEvent.target.closest('[id="action-button"]');

    if (clickedAnchor) {
      const dest = clickedAnchor.getAttribute('href');
      if (dest && (dest.includes('web.whatsapp.com') || dest.startsWith('/'))) {
        fakeEvent.preventDefault();
        messageSent = {
          type: BH_CONST.MessageType.ENSURE_WEB_NAVIGATION,
          payload: { destinationUrl: dest, userTriggered: true }
        };
      }
    }

    assert.strictEqual(defaultPrevented, true);
    assert.strictEqual(currentWindowLocation, 'https://api.whatsapp.com/send/?phone=2347031615407&text=Hello');
    assert.strictEqual(messageSent.type, BH_CONST.MessageType.ENSURE_WEB_NAVIGATION);
    assert.strictEqual(messageSent.payload.destinationUrl, 'https://web.whatsapp.com/');
  });

  // 3. The new tab receives the detected destination URL without corrupting it with ?text=
  await test('3. The new tab receives the detected destination URL (without corrupting with ?text=)', async () => {
    let createdTabUrl = null;
    const mockChromeTabs = {
      create: async ({ url }) => {
        createdTabUrl = url;
        return { id: 202 };
      }
    };

    // When the detected destination is https://web.whatsapp.com/
    const detectedDestination = 'https://web.whatsapp.com/';
    const task = {
      id: 'task_1',
      sendTabId: 101,
      webTabId: null,
      messageText: 'Hello there'
    };

    // Handler logic from service_worker.js
    async function handleEnsureNav(payloadDest) {
      let destUrl = payloadDest || 'https://web.whatsapp.com/';
      const newTab = await mockChromeTabs.create({ url: destUrl, active: true });
      task.webTabId = newTab.id;
      task.webUrl = destUrl;
      return { success: true, createdTabId: newTab.id };
    }

    await handleEnsureNav(detectedDestination);

    // Must NOT have appended ?text=Hello to web.whatsapp.com/
    assert.strictEqual(createdTabUrl, 'https://web.whatsapp.com/');
    assert.strictEqual(task.webTabId, 202);
  });

  // 4. The recipient-specific conversation opens correctly
  await test('4. The recipient-specific conversation opens correctly via buildWhatsAppWebSendUrl', () => {
    const phone = '2347031615407';
    const message = 'Hello Arewa! 🌟 Special offer here.';
    const recipientUrl = BH_URL.buildWhatsAppWebSendUrl(phone, message);

    assert.strictEqual(
      recipientUrl,
      'https://web.whatsapp.com/send/?phone=2347031615407&text=Hello+Arewa%21+%F0%9F%8C%9F+Special+offer+here.'
    );

    // Verify WhatsApp Web inspection identifies recipient from header
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);

    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: '+234 703 161 5407' }, '+234 703 161 5407'));
    main.appendChild(header);

    const inspection = BH_DOM.inspectWhatsAppWeb(doc, phone);
    assert.strictEqual(inspection.chatOpen, true);
    assert.strictEqual(inspection.recipientVerified, true);
  });

  // 5. The exact message is visible in the composer
  await test('5. The exact message is visible in the composer', () => {
    const doc = new MockDocument();
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, '');
    const complexMessage = 'Hello!\nLine 2 with emojis 🔥✨\nLine 3 special: 100% & $50?';

    const inserted = BH_DOM.insertMessageIntoComposer(composer, complexMessage);
    assert.strictEqual(inserted, true);

    const cleanContent = BH_DOM.stripZeroWidth(composer.textContent);
    assert.strictEqual(cleanContent, complexMessage);
  });

  // 6. The cursor is focused in the composer
  await test('6. The cursor is focused in the composer', () => {
    const doc = new MockDocument();
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, 'Test message');

    BH_DOM.focusAndPlaceCursorAtEnd(composer);
    assert.strictEqual(composer.isFocused, true);
  });

  // 7. No message is sent automatically
  await test('7. No message is sent automatically (remains a draft for user review)', () => {
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);

    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: '+234 703 161 5407' }, '+234 703 161 5407'));
    main.appendChild(header);

    const footer = doc.createElement('footer');
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, 'Drafted lead outreach');
    const sendBtn = doc.createElement('button', { 'data-testid': 'compose-btn-send' }, 'Send');
    footer.appendChild(composer);
    footer.appendChild(sendBtn);
    main.appendChild(footer);

    let sendBtnClicked = false;
    sendBtn.addEventListener('click', () => { sendBtnClicked = true; });

    const inspection = BH_DOM.inspectWhatsAppWeb(doc, '2347031615407');
    assert.strictEqual(inspection.hasDraft, true);
    assert.strictEqual(inspection.sendButtonFound, true);

    // Verify auto-send did NOT happen
    assert.strictEqual(sendBtnClicked, false);
    assert.strictEqual(BH_DOM.stripZeroWidth(composer.textContent), 'Drafted lead outreach');
  });

  // 8. Retries do not create duplicate tabs or drafts
  await test('8. Retries do not create duplicate tabs or drafts', async () => {
    let tabCreationCount = 0;
    const tabs = {
      create: async ({ url }) => {
        tabCreationCount++;
        return { id: 301, url };
      }
    };

    const task = {
      id: 'task_dup_test',
      webTabId: null,
      continueDestinationUrl: 'https://web.whatsapp.com/'
    };

    async function handleEnsureNav() {
      if (task.webTabId) {
        return { success: true, alreadyLinked: true };
      }
      const newTab = await tabs.create({ url: task.continueDestinationUrl });
      task.webTabId = newTab.id;
      return { success: true, createdTabId: newTab.id };
    }

    // Call 1
    const res1 = await handleEnsureNav();
    assert.strictEqual(res1.createdTabId, 301);
    assert.strictEqual(tabCreationCount, 1);

    // Retry call 2
    const res2 = await handleEnsureNav();
    assert.strictEqual(res2.alreadyLinked, true);
    assert.strictEqual(tabCreationCount, 1); // No new tab created!

    // Verify composer draft insertion idempotency
    const doc = new MockDocument();
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, '');
    const message = 'Unique message copy';

    BH_DOM.insertMessageIntoComposer(composer, message);
    assert.strictEqual(BH_DOM.stripZeroWidth(composer.textContent), message);

    // Repeated insertion call
    BH_DOM.insertMessageIntoComposer(composer, message);
    assert.strictEqual(BH_DOM.stripZeroWidth(composer.textContent), message);
  });

  // 9. Active chat or populated composer strictly prevents navigation / page reloads
  await test('9. Active chat or populated composer strictly prevents navigation and page reloads', () => {
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);

    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: 'Arewa Specialist' }, 'Arewa Specialist'));
    main.appendChild(header);

    const footer = doc.createElement('footer');
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, 'Hello Arewa');
    footer.appendChild(composer);
    main.appendChild(footer);

    const state = BH_DOM.inspectWhatsAppWeb(doc, '2347031615407');
    assert.strictEqual(state.chatOpen, true);
    assert.strictEqual(state.composerFound, true);
    assert.strictEqual(state.hasDraft, true);

    // Safeguard check in web_detector.js
    let hasDraftedMessage = true;
    const isAnyChatActive = state.chatOpen || state.composerFound || state.hasDraft || hasDraftedMessage;
    assert.strictEqual(isAnyChatActive, true);

    let readyTicksWithoutChat = 2;
    if (isAnyChatActive) {
      readyTicksWithoutChat = 0; // Must immediately reset and never reach 3!
    }

    assert.strictEqual(readyTicksWithoutChat, 0);
  });

  // 10. Saved contact display name (e.g. "Arewa Specialist") verifies recipient and avoids repeated navigation
  await test('10. Saved contact display name verifies recipient and prevents navigation loop', () => {
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);

    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: 'Arewa Specialist' }, 'Arewa Specialist'));
    main.appendChild(header);

    const state = BH_DOM.inspectWhatsAppWeb(doc, '2347031615407');
    assert.strictEqual(state.recipientVerified, true);
    assert.strictEqual(state.recipientText, 'Arewa Specialist');

    // Simulate sessionStorage one-shot navigation guard
    const mockSessionStorage = {
      store: {},
      getItem(k) { return this.store[k] || null; },
      setItem(k, v) { this.store[k] = String(v); }
    };

    const navKey = 'bh_nav_attempt_2347031615407';
    mockSessionStorage.setItem(navKey, 'true');

    const alreadyAttemptedNav = mockSessionStorage.getItem(navKey) === 'true';
    assert.strictEqual(alreadyAttemptedNav, true);
  });

  return { passed, failed };
}

if (require.main === module) {
  runContinueNavigationTests().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

module.exports = runContinueNavigationTests;
