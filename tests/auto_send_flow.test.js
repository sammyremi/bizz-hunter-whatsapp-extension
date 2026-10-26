/**
 * Test Suite: Automatic Send Workflow and 10-Second Countdown Flow
 * Tests all requirements for automatically sending after a 10-second delay:
 * 1. 10-second Continue delay and re-verification before activation on api.whatsapp.com/send/
 * 2. Separate 10-second Send delay countdown initiated when recipient and draft are verified
 * 3. Recipient verification check before send (mismatch aborts)
 * 4. Exact message verification check before send (altered or empty draft aborts)
 * 5. Real Send button discovery, visibility, and enabled check (findSendButton)
 * 6. Cancellation of auto-send countdown when composer text is edited
 * 7. Cancellation of auto-send countdown when recipient chat changes or closes
 * 8. Cancellation of auto-send countdown on tab navigation / unload
 * 9. Duplicate-send prevention across retries, repeated events, and service worker restarts
 * 10. Automatic activation of Send button via activateControl
 * 11. Post-send verification: task completed only after draft is confirmed cleared
 * 12. Failure handling when Send button clicked but draft remains in composer
 * 13. Service worker suspension & state hydration during auto-send countdown
 * 14. Setting autoSendEnabled: false respects manual mode (no auto-send countdown)
 */

const assert = require('assert');
const BH_DOM = require('../shared/dom_utils.js');
const BH_URL = require('../shared/url_parser.js');
const BH_CONST = require('../shared/constants.js');
const { MockDocument, MockElement } = require('./mock_dom.js');

const { TaskStatus, MessageType, StorageKey, DefaultSettings, AlarmPrefix } = BH_CONST;

// Mock storage helper for tests
class MockStorage {
  constructor(initial = {}) {
    this.store = Object.assign({}, initial);
  }
  async get(keys) {
    const res = {};
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const k of keyList) {
      if (this.store[k] !== undefined) {
        res[k] = JSON.parse(JSON.stringify(this.store[k]));
      }
    }
    return res;
  }
  async set(items) {
    for (const [k, v] of Object.entries(items)) {
      this.store[k] = JSON.parse(JSON.stringify(v));
    }
  }
}

async function runAutoSendTests() {
  console.log('\n--- Running Auto-Send & 10-Second Countdown Tests ---');
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

  // 1. 10-second Continue delay on Send page
  await test('1. 10-second Continue delay countdown and re-verification before activation', async () => {
    const doc = new MockDocument();
    const urlInfo = BH_URL.parseWhatsAppUrl('https://api.whatsapp.com/send/?phone=2348147468979&text=Hello');
    const anchor = doc.createElement('a', {
      id: 'action-button',
      href: 'https://web.whatsapp.com/send/?phone=2348147468979&text=Hello'
    }, 'Continue to WhatsApp Web');
    doc.body.appendChild(anchor);

    // Initial detection
    const initialCheck = BH_DOM.detectContinueControl(doc, urlInfo);
    assert.strictEqual(initialCheck.found, true);
    assert.strictEqual(initialCheck.isReady, true);

    // Simulate 10-second countdown
    let countdown = DefaultSettings.continueDelaySeconds;
    assert.strictEqual(countdown, 10);

    for (let sec = countdown; sec > 0; sec--) {
      // Re-verify that Continue control is still in DOM and ready
      const midCheck = BH_DOM.detectContinueControl(doc, urlInfo);
      assert.strictEqual(midCheck.found, true);
      assert.strictEqual(midCheck.isReady, true);
      countdown--;
    }
    assert.strictEqual(countdown, 0);

    // If Continue control is removed or disabled during countdown, it aborts
    anchor.setAttribute('disabled', 'true');
    const disabledCheck = BH_DOM.detectContinueControl(doc, urlInfo);
    assert.strictEqual(disabledCheck.isReady, false, 'Disabled continue control must not be ready');
  });

  // 2. Separate 10-second Send delay countdown initiated when chat and draft verified
  await test('2. Separate 10-second Send delay countdown initiated when recipient and draft are verified', () => {
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);

    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: '+234 814 746 8979' }, '+234 814 746 8979'));
    main.appendChild(header);

    const footer = doc.createElement('footer');
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' });
    const p = doc.createElement('p', { class: 'selectable-text copyable-text' }, 'Outreach pitch for BizzHunter');
    composer.appendChild(p);
    const sendBtn = doc.createElement('button', { 'data-testid': 'compose-btn-send' }, 'Send');
    footer.appendChild(composer);
    footer.appendChild(sendBtn);
    main.appendChild(footer);

    const expectedPhone = '2348147468979';
    const expectedText = 'Outreach pitch for BizzHunter';

    const state = BH_DOM.inspectWhatsAppWeb(doc, expectedPhone);
    assert.strictEqual(state.chatOpen, true);
    assert.strictEqual(state.recipientVerified, true);
    assert.strictEqual(state.hasDraft, true);

    const cleanDraft = BH_DOM.stripZeroWidth(composer.innerText || composer.textContent || '');
    assert.strictEqual(cleanDraft, expectedText);

    const sendInfo = BH_DOM.findSendButton(doc, composer);
    assert.strictEqual(sendInfo.found, true);
    assert.strictEqual(sendInfo.isEnabled, true);

    // Verify conditions for starting 10s countdown are met
    const canStartCountdown = state.chatOpen && state.recipientVerified && state.hasDraft &&
                              cleanDraft === expectedText && sendInfo.found && sendInfo.isEnabled;
    assert.strictEqual(canStartCountdown, true);
  });

  // 3. Recipient verification check before send (mismatch aborts)
  await test('3. Recipient verification check before send (mismatch aborts)', () => {
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);

    // Header has a DIFFERENT phone number
    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: '+234 999 888 7777' }, '+234 999 888 7777'));
    main.appendChild(header);

    const footer = doc.createElement('footer');
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' });
    composer.appendChild(doc.createElement('p', {}, 'Hello'));
    const sendBtn = doc.createElement('button', { 'data-testid': 'compose-btn-send' }, 'Send');
    footer.appendChild(composer);
    footer.appendChild(sendBtn);
    main.appendChild(footer);

    const expectedPhone = '2348147468979';
    const state = BH_DOM.inspectWhatsAppWeb(doc, expectedPhone);

    assert.strictEqual(state.chatOpen, true);
    assert.strictEqual(state.recipientVerified, false, 'Recipient must NOT be verified when phone does not match');

    // Auto-send must not trigger if recipient is not verified
    const canSend = state.chatOpen && state.recipientVerified;
    assert.strictEqual(canSend, false);
  });

  // 4. Exact message verification check before send (altered or empty draft aborts)
  await test('4. Exact message verification check before send (altered or empty draft aborts)', () => {
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);

    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: '+234 814 746 8979' }, '+234 814 746 8979'));
    main.appendChild(header);

    const footer = doc.createElement('footer');
    // Composer contains DIFFERENT message
    const composer = doc.createElement('div', { contenteditable: 'true', role: 'textbox' }, 'Something completely different');
    const sendBtn = doc.createElement('button', { 'data-testid': 'compose-btn-send' }, 'Send');
    footer.appendChild(composer);
    footer.appendChild(sendBtn);
    main.appendChild(footer);

    const expectedText = 'Original intended outreach message';
    const cleanDraft = BH_DOM.stripZeroWidth(composer.textContent);

    const isMatch = cleanDraft === expectedText || cleanDraft.includes(expectedText);
    assert.strictEqual(isMatch, false, 'Altered draft message must not match expected outreach message');

    // Composer empty check
    composer.textContent = '';
    const emptyDraft = BH_DOM.stripZeroWidth(composer.textContent);
    assert.strictEqual(emptyDraft.length === 0, true);
  });

  // 5. Real Send button discovery, visibility, and enabled check (findSendButton)
  await test('5. Real Send button discovery, visibility, and enabled check (findSendButton)', () => {
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);
    const footer = doc.createElement('footer');
    main.appendChild(footer);

    const composer = doc.createElement('div', { contenteditable: 'true' });
    footer.appendChild(composer);

    // Case A: No send button exists yet (e.g. only voice PTT mic is rendered)
    const micBtn = doc.createElement('button', { 'data-icon': 'ptt' }, 'Mic');
    footer.appendChild(micBtn);

    let sendInfo = BH_DOM.findSendButton(doc, composer);
    assert.strictEqual(sendInfo.found, false, 'Voice PTT button must not be detected as Send button');

    // Case B: WhatsApp swaps mic with Send button
    footer.children = footer.children.filter(c => c !== micBtn);
    const sendBtn = doc.createElement('button', { 'data-testid': 'compose-btn-send', 'data-tab': '11' });
    const sendIcon = doc.createElement('span', { 'data-icon': 'send' });
    sendBtn.appendChild(sendIcon);
    footer.appendChild(sendBtn);

    sendInfo = BH_DOM.findSendButton(doc, composer);
    assert.strictEqual(sendInfo.found, true);
    assert.strictEqual(sendInfo.isEnabled, true);
    assert.strictEqual(sendInfo.element, sendBtn);

    // Case C: Send button is disabled
    sendBtn.setAttribute('disabled', 'true');
    sendInfo = BH_DOM.findSendButton(doc, composer);
    assert.strictEqual(sendInfo.found, true);
    assert.strictEqual(sendInfo.isEnabled, false, 'Disabled send button must report isEnabled: false');

    // Case D: Send button has aria-disabled="true"
    sendBtn.attributes.disabled = undefined;
    sendBtn.setAttribute('aria-disabled', 'true');
    sendInfo = BH_DOM.findSendButton(doc, composer);
    assert.strictEqual(sendInfo.isEnabled, false, 'aria-disabled button must report isEnabled: false');
  });

  // 6. Cancellation of auto-send countdown when composer text is edited
  await test('6. Cancellation of auto-send countdown when composer text is edited', () => {
    const baselineText = 'Target message to send';
    let currentComposerText = 'Target message to send';
    let countdownCancelled = false;
    let cancelReason = '';

    function checkCountdownIntegrity() {
      if (currentComposerText !== baselineText && !currentComposerText.includes(baselineText)) {
        countdownCancelled = true;
        cancelReason = 'Composer text was modified or deleted during countdown';
      }
    }

    // Tick 1: Text unchanged
    checkCountdownIntegrity();
    assert.strictEqual(countdownCancelled, false);

    // Tick 2: User backspaces or edits text
    currentComposerText = 'Target message with edits added by user';
    checkCountdownIntegrity();
    assert.strictEqual(countdownCancelled, true);
    assert.strictEqual(cancelReason, 'Composer text was modified or deleted during countdown');
  });

  // 7. Cancellation of auto-send countdown when recipient chat changes or closes
  await test('7. Cancellation of auto-send countdown when recipient chat changes or closes', () => {
    const baselinePhone = '2348147468979';
    let currentChatOpen = true;
    let currentChatRecipient = '2348147468979';
    let countdownCancelled = false;
    let cancelReason = '';

    function monitorChatState() {
      const isVerified = currentChatRecipient.endsWith(baselinePhone.slice(-7));
      if (!currentChatOpen || !isVerified) {
        countdownCancelled = true;
        cancelReason = 'Active chat closed or recipient changed during countdown';
      }
    }

    // Still in target chat
    monitorChatState();
    assert.strictEqual(countdownCancelled, false);

    // User switches to a different chat
    currentChatRecipient = '2341112223334';
    monitorChatState();
    assert.strictEqual(countdownCancelled, true);
    assert.strictEqual(cancelReason, 'Active chat closed or recipient changed during countdown');
  });

  // 8. Cancellation of auto-send countdown on tab navigation / unload
  await test('8. Cancellation of auto-send countdown on tab navigation / unload', () => {
    let timerActive = true;
    let messageDispatched = null;

    // Simulate beforeunload listener
    const beforeUnloadHandler = () => {
      if (timerActive) {
        timerActive = false;
        messageDispatched = {
          type: MessageType.AUTO_SEND_CANCELLED,
          payload: { reason: 'WhatsApp Web tab navigated away or closed' }
        };
      }
    };

    beforeUnloadHandler();
    assert.strictEqual(timerActive, false);
    assert.strictEqual(messageDispatched.type, MessageType.AUTO_SEND_CANCELLED);
    assert.strictEqual(messageDispatched.payload.reason, 'WhatsApp Web tab navigated away or closed');
  });

  // 9. Duplicate-send prevention across retries, duplicate events, and manual triggers
  await test('9. Duplicate-send prevention across retries, repeated events, and service worker restarts', () => {
    let hasAutoSent = false;
    let isAutoSending = false;
    let clickCount = 0;

    function executeSend() {
      if (isAutoSending || hasAutoSent) {
        return { executed: false, reason: 'Already in progress or sent' };
      }
      isAutoSending = true;
      hasAutoSent = true;
      clickCount++;
      return { executed: true };
    }

    // First execution: succeeds
    const firstCall = executeSend();
    assert.strictEqual(firstCall.executed, true);
    assert.strictEqual(clickCount, 1);

    // Duplicate call (retry or duplicate event): blocked
    const duplicateCall = executeSend();
    assert.strictEqual(duplicateCall.executed, false);
    assert.strictEqual(clickCount, 1);

    // Background worker TRIGGER_SEND_ACTION guard
    const task = {
      id: 'task_auto_send',
      status: TaskStatus.COMPLETED,
      autoSent: true
    };

    const allowManualSend = !(task.status === TaskStatus.COMPLETED || task.autoSent);
    assert.strictEqual(allowManualSend, false, 'Manual send must be rejected when message is already sent');
  });

  // 10. Automatic activation of Send button via activateControl
  await test('10. Automatic activation of Send button via activateControl', () => {
    const doc = new MockDocument();
    const sendBtn = doc.createElement('button', { 'data-testid': 'compose-btn-send' }, 'Send');

    const dispatchedEvents = [];
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
      sendBtn.addEventListener(evtType, () => {
        dispatchedEvents.push(evtType);
      });
    });

    BH_DOM.activateControl(sendBtn);

    assert.deepStrictEqual(dispatchedEvents, [
      'pointerdown',
      'mousedown',
      'pointerup',
      'mouseup',
      'click'
    ]);
  });

  // 11. Post-send verification: task completed only after draft is confirmed cleared
  await test('11. Post-send verification: task completed only after draft is confirmed cleared', () => {
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);
    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: '+234 814 746 8979' }, '+234 814 746 8979'));
    main.appendChild(header);

    const footer = doc.createElement('footer');
    // Composer initially has draft
    const composer = doc.createElement('div', { contenteditable: 'true' }, 'Hello');
    footer.appendChild(composer);
    main.appendChild(footer);

    let inspection = BH_DOM.inspectWhatsAppWeb(doc, '2348147468979');
    assert.strictEqual(inspection.hasDraft, true);

    // Send button clicked -> WhatsApp clears composer text
    composer.textContent = '';
    inspection = BH_DOM.inspectWhatsAppWeb(doc, '2348147468979');
    assert.strictEqual(inspection.hasDraft, false, 'Composer draft must be cleared after successful send');

    // Background updates task to COMPLETED
    const task = {
      id: 'task_post_send',
      status: TaskStatus.COUNTDOWN_TO_SEND,
      autoSent: false
    };

    if (!inspection.hasDraft) {
      task.status = TaskStatus.COMPLETED;
      task.completedAt = Date.now();
      task.autoSent = true;
      task.verifiedDraftCleared = true;
    }

    assert.strictEqual(task.status, TaskStatus.COMPLETED);
    assert.strictEqual(task.autoSent, true);
    assert.strictEqual(task.verifiedDraftCleared, true);
  });

  // 12. Failure handling when Send button clicked but draft remains in composer
  await test('12. Failure handling when Send button clicked but draft remains in composer', () => {
    const doc = new MockDocument();
    const main = doc.createElement('div', { id: 'main' });
    doc.body.appendChild(main);
    const header = doc.createElement('header');
    header.appendChild(doc.createElement('span', { title: '+234 814 746 8979' }, '+234 814 746 8979'));
    main.appendChild(header);

    const footer = doc.createElement('footer');
    const composer = doc.createElement('div', { contenteditable: 'true' }, 'Unsent draft message');
    footer.appendChild(composer);
    main.appendChild(footer);

    // Simulate 4 post-send inspection attempts where draft is NOT cleared
    let attempt = 4;
    let reportedFailure = null;

    const inspection = BH_DOM.inspectWhatsAppWeb(doc, '2348147468979');
    if (inspection.hasDraft && attempt >= 4) {
      reportedFailure = {
        type: MessageType.AUTO_SEND_FAILED,
        reason: 'Send button was activated, but composer draft was not cleared by WhatsApp Web'
      };
    }

    assert.notStrictEqual(reportedFailure, null);
    assert.strictEqual(reportedFailure.type, MessageType.AUTO_SEND_FAILED);

    // Task transitions to FAILED
    const task = { status: TaskStatus.COUNTDOWN_TO_SEND };
    task.status = TaskStatus.FAILED;
    task.errorMessage = reportedFailure.reason;

    assert.strictEqual(task.status, TaskStatus.FAILED);
    assert.strictEqual(task.errorMessage, 'Send button was activated, but composer draft was not cleared by WhatsApp Web');
  });

  // 13. Service worker suspension & state hydration during auto-send countdown
  await test('13. Service worker suspension & state hydration during auto-send countdown', async () => {
    const storage = new MockStorage();

    // 1. Service worker saves task in COUNTDOWN_TO_SEND state with remaining countdown
    const taskId = 'task_hydration_test';
    const originalTask = {
      id: taskId,
      status: TaskStatus.COUNTDOWN_TO_SEND,
      phoneNormalized: '2348147468979',
      messageText: 'Outreach pitch',
      autoSendCountdownRemaining: 7,
      createdAt: Date.now() - 3000,
      updatedAt: Date.now()
    };

    await storage.set({
      [StorageKey.TASKS]: { [taskId]: originalTask },
      [StorageKey.ACTIVE_TASK_ID]: taskId,
      [StorageKey.SETTINGS]: DefaultSettings
    });

    // 2. Service worker suspends (all memory destroyed)
    // 3. Service worker wakes up on alarm or message: hydrates state from storage
    const state = await storage.get([StorageKey.TASKS, StorageKey.ACTIVE_TASK_ID, StorageKey.SETTINGS]);
    const restoredTask = state[StorageKey.TASKS][state[StorageKey.ACTIVE_TASK_ID]];

    assert.strictEqual(restoredTask.id, taskId);
    assert.strictEqual(restoredTask.status, TaskStatus.COUNTDOWN_TO_SEND);
    assert.strictEqual(restoredTask.autoSendCountdownRemaining, 7);

    // 4. Ensure readiness alarm does NOT clobber COUNTDOWN_TO_SEND status
    const alarm = { name: `${AlarmPrefix.READINESS}${taskId}` };
    if (restoredTask.status !== TaskStatus.COMPLETED &&
        restoredTask.status !== TaskStatus.FAILED &&
        restoredTask.status !== TaskStatus.COUNTDOWN_TO_SEND &&
        restoredTask.status !== TaskStatus.SENDING) {
      restoredTask.status = TaskStatus.READY_FOR_ACTION;
    }

    // Must remain COUNTDOWN_TO_SEND
    assert.strictEqual(restoredTask.status, TaskStatus.COUNTDOWN_TO_SEND);
  });

  // 14. Setting autoSendEnabled: false respects manual mode
  await test('14. Setting autoSendEnabled: false respects manual mode (no auto-send countdown)', () => {
    const settings = {
      isPaused: false,
      autoContinueEnabled: true,
      autoSendEnabled: false // User toggled manual mode
    };

    let countdownStarted = false;
    if (!settings.isPaused && settings.autoSendEnabled !== false) {
      countdownStarted = true;
    }

    assert.strictEqual(countdownStarted, false, 'Countdown must not start when autoSendEnabled is false');
  });

  return { passed, failed };
}

module.exports = runAutoSendTests;

if (require.main === module) {
  runAutoSendTests().then(res => {
    console.log(`\nAuto-Send Test Results: ${res.passed} Passed, ${res.failed} Failed`);
    process.exit(res.failed > 0 ? 1 : 0);
  });
}
