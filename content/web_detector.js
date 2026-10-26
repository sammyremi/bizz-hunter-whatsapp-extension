/**
 * Bizz-Hunter WhatsApp Assistant - WhatsApp Web Content Script
 * Injected on web.whatsapp.com/*
 * Inspects chat state, recipient header, message composer, and handles user-triggered send actions.
 */
(function () {
  'use strict';

  // Prevent duplicate instances
  if (window.__BIZZHUNTER_WEB_DETECTOR_LOADED__) return;
  window.__BIZZHUNTER_WEB_DETECTOR_LOADED__ = true;

  console.log('[BizzHunter-WA] WhatsApp Web detector initialized on tab');

  // Capture text and phone from URL immediately upon script load before client-side router changes URL
  let initialUrlText = '';
  let initialUrlPhone = '';
  try {
    const urlParams = new URLSearchParams(window.location.search);
    initialUrlText = urlParams.get('text') || '';
    initialUrlPhone = urlParams.get('phone') || '';
  } catch {}

  let activeCheckInterval = null;
  let lastReportedState = null;
  let checkAttempts = 0;
  let hasDraftedMessage = false;
  let insertionAttempts = 0;
  let readyTicksWithoutChat = 0;
  let hasNavigatedToRecipientChat = false;
  let currentTaskId = null;
  let isCountdownStarting = false;
  const MAX_CHECK_ATTEMPTS = 90; // 90 seconds of monitoring for slower connections

  /**
   * Retrieves expected recipient phone, message text, and task ID from URL or local storage.
   */
  async function getExpectedTaskInfo() {
    let phone = initialUrlPhone;
    let text = initialUrlText;
    let taskId = currentTaskId;

    try {
      const data = await chrome.storage.local.get([
        BH.StorageKey.PENDING_MESSAGE_TEXT,
        BH.StorageKey.PENDING_PHONE,
        BH.StorageKey.ACTIVE_TASK_ID,
        BH.StorageKey.TASKS
      ]);

      if (!text && data[BH.StorageKey.PENDING_MESSAGE_TEXT]) {
        text = data[BH.StorageKey.PENDING_MESSAGE_TEXT];
      }
      if (!phone && data[BH.StorageKey.PENDING_PHONE]) {
        phone = data[BH.StorageKey.PENDING_PHONE];
      }

      const activeId = data[BH.StorageKey.ACTIVE_TASK_ID];
      if (activeId) {
        taskId = activeId;
        currentTaskId = activeId;
      }

      const activeTask = activeId && data[BH.StorageKey.TASKS] ? data[BH.StorageKey.TASKS][activeId] : null;

      if (activeTask) {
        if (!phone) phone = activeTask.phoneNormalized || activeTask.phone || '';
        if (!text) text = activeTask.messageText || '';
      }

      if ((!phone || !text) && data[BH.StorageKey.TASKS]) {
        const list = Object.values(data[BH.StorageKey.TASKS]);
        const recent = list.reverse().find(t => t.phoneNormalized || t.messageText);
        if (recent) {
          if (!phone) phone = recent.phoneNormalized || recent.phone || '';
          if (!text) text = recent.messageText || '';
          if (!taskId) taskId = recent.id;
        }
      }
    } catch (err) {
      console.warn('[BizzHunter-WA] Error reading task info from storage:', err);
    }

    if (taskId) currentTaskId = taskId;
    return { expectedPhone: phone, expectedText: text, taskId: currentTaskId };
  }

  /**
   * Ensures the message is open directly in the chat box and composer is focused with cursor at end.
   * Only runs when the recipient is verified!
   */
  async function ensureMessageInChatBox(composerEl, expectedText, expectedPhone, recipientVerified) {
    if (!composerEl) return;

    // Critical Requirement 4: Verify that the active chat matches the intended recipient
    // before populating the composer!
    if (expectedPhone && !recipientVerified) {
      console.log(`[BizzHunter-WA] Waiting for intended recipient (${expectedPhone}) before drafting...`);
      return;
    }

    const rawCurrent = composerEl.innerText || composerEl.textContent || '';
    const cleanCurrent = BH.stripZeroWidth(rawCurrent);

    // If chat composer already has the expected message:
    if (expectedText && (cleanCurrent === expectedText || cleanCurrent.includes(expectedText))) {
      BH.activateAndFocusComposer(composerEl, expectedText);
      hasDraftedMessage = true;
      console.log('[BizzHunter-WA] Message confirmed drafted in chat box');
      return;
    }

    // Do not repeatedly overwrite the user's edits once the message has been successfully drafted
    if (hasDraftedMessage) {
      return;
    }

    // If the composer is empty and we have an expected message to insert
    if (expectedText && cleanCurrent.length === 0) {
      insertionAttempts++;
      console.log(`[BizzHunter-WA] Populating message into composer (attempt ${insertionAttempts}, length: ${expectedText.length})...`);
      const inserted = BH.insertMessageIntoComposer(composerEl, expectedText);

      // Verify that composer now actually contains the expected text
      const verifiedClean = BH.stripZeroWidth(composerEl.innerText || composerEl.textContent || '');
      if (inserted || verifiedClean === expectedText || verifiedClean.includes(expectedText)) {
        hasDraftedMessage = true;
        console.log('[BizzHunter-WA] ✓ Message successfully drafted and focused in WhatsApp chat box!');
      } else if (insertionAttempts >= 5) {
        console.warn('[BizzHunter-WA] Reached max insertion attempts for composer');
      }
    }
  }

  // 1. Initial notification to background that WhatsApp Web is active
  chrome.runtime.sendMessage({
    type: BH.MessageType.WEB_PAGE_DETECTED,
    payload: {
      url: window.location.href
    }
  }).then(res => {
    if (res && res.taskId) currentTaskId = res.taskId;
  }).catch(() => {});

  // 2. Periodic state inspector (1-second intervals while loading and settling)
  async function runStateInspection() {
    checkAttempts++;

    // 1. Retrieve expected task details (phone and text)
    const { expectedPhone, expectedText } = await getExpectedTaskInfo();

    // 2. Inspect WhatsApp Web DOM with expectedPhone for recipient matching
    let state = BH.inspectWhatsAppWeb(document, expectedPhone);

    // 3. If WhatsApp Web shows "Use Here" dialog (when open in another tab/window), auto-click it
    if (state.isUseHerePrompt && state.useHereButtonElement) {
      console.log('[BizzHunter-WA] "Use Here" dialog detected, activating tab...');
      try {
        state.useHereButtonElement.click();
      } catch {}
    }

    // 4. If chat is open and composer is found, make sure message is directly opened in the chat box!
    if (state.chatOpen && state.composerFound) {
      await ensureMessageInChatBox(state.composerElement, expectedText, expectedPhone, state.recipientVerified);
      // Re-inspect to capture newly inserted draft
      state = BH.inspectWhatsAppWeb(document, expectedPhone);
    }

    // 4b. Automatic Send Workflow:
    // When message is verified drafted, active chat matches intended recipient, and send button is enabled,
    // start a separate 10-second countdown to automatically click Send.
    if (state.chatOpen && state.recipientVerified && state.hasDraft && expectedPhone && expectedText) {
      const cleanDraft = BH.stripZeroWidth(state.composerElement ? (state.composerElement.innerText || state.composerElement.textContent || '') : '');
      const isMessageMatched = cleanDraft === expectedText || cleanDraft.includes(expectedText);
      const sendBtnInfo = BH.findSendButton(document, state.composerElement);

      if (isMessageMatched && sendBtnInfo.found && sendBtnInfo.isEnabled) {
        if (!autoSendCountdownTimer && !isAutoSending && !hasAutoSent && !isCountdownStarting) {
          isCountdownStarting = true;
          try {
            const data = await chrome.storage.local.get([
              BH.StorageKey.SETTINGS,
              BH.StorageKey.TASKS,
              BH.StorageKey.ACTIVE_TASK_ID
            ]);
            const settings = Object.assign({}, BH.DefaultSettings, (data && data[BH.StorageKey.SETTINGS]) || {});
            const activeId = (data && data[BH.StorageKey.ACTIVE_TASK_ID]) || currentTaskId;
            const activeTask = activeId && data[BH.StorageKey.TASKS] ? data[BH.StorageKey.TASKS][activeId] : null;

            // If task is already sending, sent, completed, or locked, do not start countdown
            if (activeTask && (activeTask.status === BH.TaskStatus.SENDING ||
                               activeTask.status === BH.TaskStatus.SENT ||
                               activeTask.status === BH.TaskStatus.COMPLETED ||
                               activeTask.autoSent ||
                               activeTask.sendLocked)) {
              hasAutoSent = true;
              isCountdownStarting = false;
              return;
            }

            if (!settings.isPaused && settings.autoSendEnabled !== false) {
              startAutoSendCountdown(expectedPhone, expectedText, settings, activeId);
            }
          } catch (err) {
            console.warn('[BizzHunter-WA] Error reading settings for auto-send:', err);
          } finally {
            isCountdownStarting = false;
          }
        }
      }
    }

    // 5. Requirement 7: Open recipient chat ONLY if NO conversation or composer is active.
    // If WhatsApp Web is ready but NO chat or composer is open at all, navigate to recipient send URL ONCE.
    // Under NO circumstance reload or navigate if chat is already open, composer is found, or draft is present!
    const isWebReady = state.isAppLoaded && !state.isConnecting && !state.isQrScreen && !state.isInvalidNumber;
    const isAnyChatActive = state.chatOpen || state.composerFound || state.hasDraft || hasDraftedMessage;

    if (isAnyChatActive) {
      readyTicksWithoutChat = 0;
    } else if (isWebReady && expectedPhone) {
      readyTicksWithoutChat++;
      const navSessionKey = `bh_nav_attempt_${expectedPhone}`;
      let alreadyAttemptedNav = false;
      try {
        alreadyAttemptedNav = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(navSessionKey) === 'true') || hasNavigatedToRecipientChat;
      } catch {}

      if (readyTicksWithoutChat >= 3 && !alreadyAttemptedNav) {
        hasNavigatedToRecipientChat = true;
        try {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(navSessionKey, 'true');
          }
        } catch {}

        const currentUrl = window.location.href;
        const alreadyOnRecipientUrl = currentUrl.includes('/send') && currentUrl.includes(expectedPhone);
        if (!alreadyOnRecipientUrl) {
          const recipientSendUrl = BH.buildWhatsAppWebSendUrl(expectedPhone, expectedText);
          console.log(`[BizzHunter-WA] No active chat detected. Navigating once to recipient-specific URL: ${recipientSendUrl}`);
          window.location.href = recipientSendUrl;
          return;
        }
      }
    }

    // Prepare safe summary
    const summary = {
      isAppLoaded: state.isAppLoaded,
      isConnecting: state.isConnecting,
      isQrScreen: state.isQrScreen,
      isInvalidNumber: state.isInvalidNumber,
      invalidNumberMessage: state.invalidNumberMessage,
      chatOpen: state.chatOpen,
      recipientText: state.recipientText,
      recipientVerified: state.recipientVerified,
      composerFound: state.composerFound,
      hasDraft: state.hasDraft,
      draftLength: state.draftText ? state.draftText.length : 0,
      draftSnippet: state.draftText ? (state.draftText.substring(0, 30) + '...') : '',
      sendButtonFound: state.sendButtonFound
    };

    // Only send message if state changed or key milestone reached
    const stateFingerprint = JSON.stringify({
      app: summary.isAppLoaded,
      qr: summary.isQrScreen,
      inv: summary.isInvalidNumber,
      chat: summary.chatOpen,
      rec: summary.recipientText,
      ver: summary.recipientVerified,
      draft: summary.hasDraft,
      btn: summary.sendButtonFound
    });

    if (stateFingerprint !== lastReportedState) {
      lastReportedState = stateFingerprint;

      console.log(`[BizzHunter-WA] Web State update: App=${summary.isAppLoaded}, Chat=${summary.chatOpen}, Recipient="${summary.recipientText}", Draft=${summary.hasDraft}`);

      if (summary.isInvalidNumber) {
        chrome.runtime.sendMessage({
          type: BH.MessageType.WEB_INVALID_NUMBER,
          payload: { message: summary.invalidNumberMessage }
        }).catch(() => {});
      } else {
        chrome.runtime.sendMessage({
          type: BH.MessageType.WEB_CHAT_STATUS,
          payload: summary
        }).catch(() => {});
      }
    }

    // If chat and draft are both detected, slow down polling to keep CPU low
    if (summary.chatOpen && summary.hasDraft) {
      clearInterval(activeCheckInterval);
      activeCheckInterval = setInterval(runStateInspection, 3000); // Check every 3s thereafter
    }

    if (checkAttempts >= MAX_CHECK_ATTEMPTS && (!summary.chatOpen || !summary.hasDraft)) {
      clearInterval(activeCheckInterval);
      console.log('[BizzHunter-WA] Reached max inspection timeout for chat readiness');
      if (!summary.hasDraft && expectedText) {
        chrome.runtime.sendMessage({
          type: BH.MessageType.WEB_HANDOFF_FAILED,
          payload: {
            reason: summary.chatOpen
              ? 'Chat opened but message composer was not populated'
              : 'Timed out waiting for WhatsApp Web chat to open'
          }
        }).catch(() => {});
      }
    }
  }

  // Auto-send state variables
  let autoSendCountdownTimer = null;
  let autoSendCountdownRemaining = 0;
  let isAutoSending = false;
  let hasAutoSent = false;
  let autoSendBaselinePhone = '';
  let autoSendBaselineText = '';

  /**
   * Starts the separate 10-second countdown to automatically click Send.
   */
  function startAutoSendCountdown(expectedPhone, expectedText, settings, taskId) {
    if (autoSendCountdownTimer || isAutoSending || hasAutoSent) return;

    const delaySec = (settings && settings.sendDelaySeconds !== undefined) ? settings.sendDelaySeconds : 10;
    autoSendCountdownRemaining = delaySec;
    autoSendBaselinePhone = expectedPhone;
    autoSendBaselineText = expectedText;
    if (taskId) currentTaskId = taskId;

    console.log(`[BizzHunter-WA] Message verified for ${expectedPhone} (task: ${currentTaskId}). Starting ${delaySec}s countdown to automatic send...`);

    // Notify background worker of countdown start
    chrome.runtime.sendMessage({
      type: BH.MessageType.AUTO_SEND_COUNTDOWN_TICK,
      payload: {
        taskId: currentTaskId,
        remainingSeconds: autoSendCountdownRemaining,
        phone: expectedPhone,
        textSnippet: expectedText.substring(0, 30)
      }
    }).catch(() => {});

    autoSendCountdownTimer = setInterval(async () => {
      // 1. Check settings: cancel if paused or autoSend disabled
      try {
        const data = await chrome.storage.local.get(BH.StorageKey.SETTINGS);
        const currSettings = (data && data[BH.StorageKey.SETTINGS]) || BH.DefaultSettings;
        if (currSettings.isPaused || currSettings.autoSendEnabled === false) {
          cancelAutoSend('Extension paused or autoSend disabled during countdown');
          return;
        }
      } catch {}

      // 2. Monitor DOM: re-inspect current state
      const liveState = BH.inspectWhatsAppWeb(document, autoSendBaselinePhone);

      // Check recipient
      if (!liveState.chatOpen || !liveState.recipientVerified) {
        cancelAutoSend('Active chat closed or recipient changed during countdown');
        return;
      }

      // Check composer
      if (!liveState.composerElement) {
        cancelAutoSend('Composer element lost during countdown');
        return;
      }

      // Check composer text: cancel if edited or cleared
      const liveText = BH.stripZeroWidth(liveState.composerElement.innerText || liveState.composerElement.textContent || '');
      if (liveText !== autoSendBaselineText && !liveText.includes(autoSendBaselineText)) {
        cancelAutoSend('Composer text was modified or deleted during countdown');
        return;
      }

      // Check Send button: cancel if disabled or disappeared
      const sendInfo = BH.findSendButton(document, liveState.composerElement);
      if (!sendInfo.found || !sendInfo.isEnabled) {
        cancelAutoSend('Send button became disabled or disappeared during countdown');
        return;
      }

      autoSendCountdownRemaining--;

      // Notify background countdown progress
      chrome.runtime.sendMessage({
        type: BH.MessageType.AUTO_SEND_COUNTDOWN_TICK,
        payload: {
          taskId: currentTaskId,
          remainingSeconds: Math.max(0, autoSendCountdownRemaining),
          phone: autoSendBaselinePhone
        }
      }).catch(() => {});

      console.log(`[BizzHunter-WA] Auto-send countdown: ${autoSendCountdownRemaining}s...`);

      if (autoSendCountdownRemaining <= 0) {
        clearInterval(autoSendCountdownTimer);
        autoSendCountdownTimer = null;
        executeAutoSend(autoSendBaselinePhone, autoSendBaselineText);
      }
    }, 1000);
  }

  /**
   * Cancels a pending auto-send countdown with a specific diagnostic reason.
   */
  function cancelAutoSend(reason) {
    if (autoSendCountdownTimer) {
      clearInterval(autoSendCountdownTimer);
      autoSendCountdownTimer = null;
    }
    console.warn(`[BizzHunter-WA] Auto-send countdown cancelled: ${reason}`);
    chrome.runtime.sendMessage({
      type: BH.MessageType.AUTO_SEND_CANCELLED,
      payload: { taskId: currentTaskId, reason }
    }).catch(() => {});
  }

  /**
   * Executes the automatic Send button activation after repeating all verification checks
   * and acquiring the authoritative send lock from the background service worker.
   */
  async function executeAutoSend(expectedPhone, expectedText) {
    if (isAutoSending || hasAutoSent) {
      console.warn('[BizzHunter-WA] Auto-send already in progress or completed, preventing duplicate execution');
      return;
    }

    if (autoSendCountdownTimer) {
      clearInterval(autoSendCountdownTimer);
      autoSendCountdownTimer = null;
    }

    isAutoSending = true;

    // Repeat all verification checks upon countdown expiry:
    const finalState = BH.inspectWhatsAppWeb(document, expectedPhone);

    // Verification Check 1: Active conversation must match intended recipient
    if (!finalState.chatOpen || !finalState.recipientVerified) {
      isAutoSending = false;
      reportAutoSendFailure(`Final recipient verification failed: expected ${expectedPhone}, found "${finalState.recipientText}"`);
      return;
    }

    // Verification Check 2: Composer must contain complete intended message
    if (!finalState.composerElement) {
      isAutoSending = false;
      reportAutoSendFailure('Final check failed: message composer not found');
      return;
    }

    const currentText = BH.stripZeroWidth(finalState.composerElement.innerText || finalState.composerElement.textContent || '');
    if (!currentText || (currentText !== expectedText && !currentText.includes(expectedText))) {
      isAutoSending = false;
      reportAutoSendFailure('Final check failed: composer message was altered or is empty');
      return;
    }

    // Verification Check 3 & 4: Real Send button must be located, visible, and enabled
    const sendInfo = BH.findSendButton(document, finalState.composerElement);
    if (!sendInfo.found || !sendInfo.isEnabled || !sendInfo.element) {
      isAutoSending = false;
      reportAutoSendFailure('Final check failed: real Send button is not visible or enabled');
      return;
    }

    // Authoritative Send Lock: Request lock from background worker before clicking
    try {
      const lockRes = await chrome.runtime.sendMessage({
        type: BH.MessageType.ACQUIRE_SEND_LOCK,
        payload: {
          taskId: currentTaskId,
          phone: expectedPhone
        }
      });

      if (!lockRes || !lockRes.acquired) {
        console.warn(`[BizzHunter-WA] Send lock denied: ${lockRes ? lockRes.reason : 'unknown'}. Aborting duplicate send.`);
        isAutoSending = false;
        hasAutoSent = true;
        return;
      }
    } catch (err) {
      console.error('[BizzHunter-WA] Error requesting send lock:', err);
      isAutoSending = false;
      return;
    }

    // Mark hasAutoSent to prevent duplicate execution across retries/events
    hasAutoSent = true;
    console.log(`[BizzHunter-WA] ✓ All verification checks passed & send lock acquired! Activating Send button once for ${expectedPhone}...`);

    try {
      BH.activateControl(sendInfo.element);
    } catch (err) {
      isAutoSending = false;
      reportAutoSendFailure(`Failed to click Send button: ${err.message}`);
      return;
    }

    // Post-send verification: poll to confirm draft is cleared or message appears in conversation
    setTimeout(() => {
      verifyPostSend(expectedPhone, expectedText, 1);
    }, 600);
  }

  /**
   * Verifies that the message was sent by checking for composer draft clearance
   * or appearance of the outgoing message in the conversation history.
   */
  function verifyPostSend(expectedPhone, expectedText, attempt) {
    const checkState = BH.inspectWhatsAppWeb(document, expectedPhone);

    // 1. Evidence A: Composer draft is cleared -> Message accepted and sent by WhatsApp
    if (!checkState.hasDraft) {
      console.log('[BizzHunter-WA] ✓ Post-send verified: draft cleared from composer. Task completed successfully!');
      isAutoSending = false;
      chrome.runtime.sendMessage({
        type: BH.MessageType.AUTO_SEND_COMPLETED,
        payload: {
          taskId: currentTaskId,
          phone: expectedPhone,
          timestamp: Date.now(),
          verifiedDraftCleared: true
        }
      }).catch(() => {});
      return;
    }

    // 2. Evidence B: Outgoing message bubble with matching text appears in chat history
    if (expectedText && BH.isMessageInConversation(document, expectedText)) {
      console.log('[BizzHunter-WA] ✓ Post-send verified: message confirmed present in conversation panel!');
      isAutoSending = false;
      chrome.runtime.sendMessage({
        type: BH.MessageType.AUTO_SEND_COMPLETED,
        payload: {
          taskId: currentTaskId,
          phone: expectedPhone,
          timestamp: Date.now(),
          verifiedInConversation: true
        }
      }).catch(() => {});
      return;
    }

    // Retry checking up to 4 times (around 2.5 seconds total)
    if (attempt < 4) {
      setTimeout(() => {
        verifyPostSend(expectedPhone, expectedText, attempt + 1);
      }, 600);
      return;
    }

    // If draft remains after multiple verification attempts and message is not in conversation:
    // Mark send status as unknown and stop automatic retries (NEVER blindly click Send again)
    isAutoSending = false;
    console.warn('[BizzHunter-WA] Send status ambiguous: draft remains and message not found in conversation history.');
    chrome.runtime.sendMessage({
      type: BH.MessageType.AUTO_SEND_UNKNOWN,
      payload: {
        taskId: currentTaskId,
        phone: expectedPhone,
        reason: 'Send status unknown: Send button was activated, but composer draft was not cleared and message was not confirmed in conversation'
      }
    }).catch(() => {});
  }

  function reportAutoSendFailure(reason) {
    console.error(`[BizzHunter-WA] Auto-send failure: ${reason}`);
    chrome.runtime.sendMessage({
      type: BH.MessageType.AUTO_SEND_FAILED,
      payload: { taskId: currentTaskId, reason }
    }).catch(() => {});
  }

  // Start polling
  activeCheckInterval = setInterval(runStateInspection, 1000);
  // Also run immediately
  setTimeout(runStateInspection, 500);

  // 3. Listen for User-Triggered Actions
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === BH.MessageType.EXECUTE_SEND_CLICK) {
      handleUserSendTrigger(sendResponse);
      return true; // async response
    }
  });

  /**
   * User-triggered Send action from popup.
   * Clicks the Send button only after acquiring the authoritative lock and verifying chat and draft exist.
   */
  async function handleUserSendTrigger(sendResponse) {
    if (autoSendCountdownTimer) {
      clearInterval(autoSendCountdownTimer);
      autoSendCountdownTimer = null;
    }

    if (isAutoSending || hasAutoSent) {
      sendResponse({ success: false, error: 'Send operation is already in progress or message was already sent' });
      return;
    }

    const inspection = BH.inspectWhatsAppWeb(document);

    if (!inspection.chatOpen) {
      sendResponse({ success: false, error: 'Chat is not yet open' });
      return;
    }

    if (!inspection.hasDraft) {
      sendResponse({ success: false, error: 'No draft message found in composer' });
      return;
    }

    const sendInfo = BH.findSendButton(document, inspection.composerElement);
    if (!sendInfo.found || !sendInfo.element) {
      sendResponse({ success: false, error: 'Send button could not be located in composer footer' });
      return;
    }

    // Acquire lock from service worker
    try {
      const lockRes = await chrome.runtime.sendMessage({
        type: BH.MessageType.ACQUIRE_SEND_LOCK,
        payload: {
          taskId: currentTaskId,
          phone: inspection.recipientText
        }
      });

      if (!lockRes || !lockRes.acquired) {
        sendResponse({ success: false, error: lockRes ? lockRes.reason : 'Send lock denied' });
        return;
      }
    } catch (err) {
      sendResponse({ success: false, error: err.message });
      return;
    }

    hasAutoSent = true;
    isAutoSending = true;

    try {
      console.log('[BizzHunter-WA] User triggered Send click on composer button');
      BH.activateControl(sendInfo.element);

      // Check after a brief delay if message was sent (composer should clear)
      setTimeout(() => {
        const afterCheck = BH.inspectWhatsAppWeb(document);
        isAutoSending = false;
        sendResponse({
          success: true,
          message: 'Send action initiated',
          draftCleared: !afterCheck.hasDraft
        });
        runStateInspection();
      }, 600);
    } catch (err) {
      console.error('[BizzHunter-WA] Error executing send click:', err);
      isAutoSending = false;
      sendResponse({ success: false, error: err.message });
    }
  }

  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    if (autoSendCountdownTimer) {
      clearInterval(autoSendCountdownTimer);
      autoSendCountdownTimer = null;
      chrome.runtime.sendMessage({
        type: BH.MessageType.AUTO_SEND_CANCELLED,
        payload: { taskId: currentTaskId, reason: 'WhatsApp Web tab navigated away or closed' }
      }).catch(() => {});
    }
    if (activeCheckInterval) {
      clearInterval(activeCheckInterval);
    }
  });

})();
