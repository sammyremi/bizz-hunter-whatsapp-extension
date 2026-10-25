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
  const MAX_CHECK_ATTEMPTS = 90; // 90 seconds of monitoring for slower connections

  /**
   * Retrieves expected recipient phone and message text from URL or local storage.
   */
  async function getExpectedTaskInfo() {
    let phone = initialUrlPhone;
    let text = initialUrlText;

    if (!phone || !text) {
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
          }
        }
      } catch (err) {
        console.warn('[BizzHunter-WA] Error reading task info from storage:', err);
      }
    }

    return { expectedPhone: phone, expectedText: text };
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
      BH.focusAndPlaceCursorAtEnd(composerEl);
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

    if (checkAttempts >= MAX_CHECK_ATTEMPTS && !summary.chatOpen) {
      clearInterval(activeCheckInterval);
      console.log('[BizzHunter-WA] Reached max inspection timeout for chat readiness');
    }
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
   * User-triggered Send action.
   * Clicks the Send button only after verifying chat and draft exist.
   */
  function handleUserSendTrigger(sendResponse) {
    const inspection = BH.inspectWhatsAppWeb(document);

    if (!inspection.chatOpen) {
      sendResponse({ success: false, error: 'Chat is not yet open' });
      return;
    }

    if (!inspection.hasDraft) {
      sendResponse({ success: false, error: 'No draft message found in composer' });
      return;
    }

    let sendButton = inspection.sendButtonElement;
    if (!sendButton) {
      // Try finding send button again
      const btn = document.querySelector('button[data-testid="compose-btn-send"], [data-icon="send"]');
      if (btn) {
        sendButton = btn.tagName.toLowerCase() === 'button' ? btn : btn.closest('button');
      }
    }

    if (!sendButton) {
      sendResponse({ success: false, error: 'Send button could not be located in composer footer' });
      return;
    }

    try {
      console.log('[BizzHunter-WA] User triggered Send click on composer button');
      sendButton.click();

      // Check after a brief delay if message was sent (composer should clear)
      setTimeout(() => {
        const afterCheck = BH.inspectWhatsAppWeb(document);
        sendResponse({
          success: true,
          message: 'Send action initiated',
          draftCleared: !afterCheck.hasDraft
        });
        // Run state inspection to sync background
        runStateInspection();
      }, 600);
    } catch (err) {
      console.error('[BizzHunter-WA] Error executing send click:', err);
      sendResponse({ success: false, error: err.message });
    }
  }

  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    if (activeCheckInterval) {
      clearInterval(activeCheckInterval);
    }
  });

})();
