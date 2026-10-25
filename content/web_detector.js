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

  let activeCheckInterval = null;
  let lastReportedState = null;
  let checkAttempts = 0;
  let hasEnsuredChatBox = false;
  const MAX_CHECK_ATTEMPTS = 60; // 60 seconds of monitoring

  /**
   * Ensures the message is open directly in the chat box and composer is focused with cursor at end.
   */
  async function ensureMessageInChatBox(composerEl) {
    if (!composerEl || hasEnsuredChatBox) return;

    let currentText = (composerEl.innerText || composerEl.textContent || '').trim();

    // If chat composer doesn't have the text yet, determine expected message text
    if (!currentText) {
      let expectedText = '';
      try {
        const urlParams = new URLSearchParams(window.location.search);
        expectedText = urlParams.get('text') || '';
      } catch {}

      if (!expectedText) {
        try {
          const res = await chrome.runtime.sendMessage({ type: BH.MessageType.GET_EXTENSION_STATE });
          const activeTask = res && res.state && res.state.activeTaskId
            ? res.state.tasks[res.state.activeTaskId]
            : null;
          if (activeTask && activeTask.messageText) {
            expectedText = activeTask.messageText;
          }
        } catch {}
      }

      if (expectedText) {
        console.log('[BizzHunter-WA] Opening message directly in chat box...');
        composerEl.focus();

        let inserted = false;
        try {
          inserted = document.execCommand('insertText', false, expectedText);
        } catch {}

        if (!inserted || !(composerEl.innerText || composerEl.textContent || '').trim()) {
          composerEl.innerText = expectedText;
          composerEl.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: expectedText
          }));
          composerEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }

    // Always focus the chat box and position cursor at the end
    focusAndPlaceCursorAtEnd(composerEl);
    hasEnsuredChatBox = true;
  }

  function focusAndPlaceCursorAtEnd(el) {
    if (!el) return;
    try {
      el.focus();
      if (typeof window.getSelection !== 'undefined' && typeof document.createRange !== 'undefined') {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {}
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

    let state = BH.inspectWhatsAppWeb(document);

    // If chat is open and composer is found, make sure message is directly opened in the chat box!
    if (state.chatOpen && state.composerFound) {
      await ensureMessageInChatBox(state.composerElement);
      // Re-inspect to capture newly inserted draft
      state = BH.inspectWhatsAppWeb(document);
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
