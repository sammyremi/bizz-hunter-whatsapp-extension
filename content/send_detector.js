/**
 * Bizz-Hunter WhatsApp Assistant - Send Page Content Script
 * Injected on api.whatsapp.com/send/*
 * Detects URL validity, identifies the Continue control, and notifies background worker.
 */
(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__BIZZHUNTER_SEND_DETECTOR_LOADED__) return;
  window.__BIZZHUNTER_SEND_DETECTOR_LOADED__ = true;

  const urlInfo = BH.parseWhatsAppUrl(window.location.href);

  // If this is an unrelated WhatsApp page or missing valid phone, ignore silently
  if (!urlInfo.isValid || !urlInfo.isSendEndpoint) {
    return;
  }

  // Safe diagnostic log
  console.log(`[BizzHunter-WA] Detected send link for ${urlInfo.phoneMasked} (msg length: ${urlInfo.textSummary.length})`);

  // 1. Notify background that a valid Send page is detected and store pending message text directly
  if (urlInfo.text) {
    chrome.storage.local.set({
      [BH.StorageKey.PENDING_MESSAGE_TEXT]: urlInfo.text
    }).catch(() => {});
  }

  chrome.runtime.sendMessage({
    type: BH.MessageType.SEND_PAGE_DETECTED,
    payload: {
      url: window.location.href,
      phone: urlInfo.phone,
      phoneNormalized: urlInfo.phoneNormalized,
      phoneMasked: urlInfo.phoneMasked,
      messageText: urlInfo.text || '',
      textLength: urlInfo.textSummary.length,
      textSnippet: urlInfo.textSummary.snippet
    }
  }).catch(() => {});

  // Intercept any manual click on web.whatsapp.com links to guarantee text parameter is included
  document.addEventListener('click', (e) => {
    const anchor = e.target.closest && e.target.closest('a[href*="web.whatsapp.com"]');
    if (anchor && urlInfo.text) {
      const currentHref = anchor.getAttribute('href') || '';
      if (!currentHref.includes('text=')) {
        const sep = currentHref.includes('?') ? '&' : '?';
        const enhanced = `${currentHref}${sep}text=${encodeURIComponent(urlInfo.text)}`;
        anchor.setAttribute('href', enhanced);
      }
    }
  }, true);

  let continueElement = null;
  let observerHandle = null;
  let hasAutoClicked = false;

  function ensureHrefCarriesText(el) {
    if (!el || !urlInfo.text) return;
    if (el.tagName && el.tagName.toLowerCase() === 'a') {
      const currentHref = el.getAttribute('href') || '';
      if (currentHref.includes('web.whatsapp.com') && !currentHref.includes('text=')) {
        const separator = currentHref.includes('?') ? '&' : '?';
        const enhancedHref = `${currentHref}${separator}text=${encodeURIComponent(urlInfo.text)}`;
        el.setAttribute('href', enhancedHref);
      }
    }
  }

  async function triggerAutoContinue(result) {
    if (hasAutoClicked) return;

    // Check settings from storage to verify extension is not paused
    try {
      const data = await chrome.storage.local.get(BH.StorageKey.SETTINGS);
      const settings = data[BH.StorageKey.SETTINGS] || BH.DefaultSettings;
      if (settings.isPaused || settings.autoContinueEnabled === false) {
        console.log('[BizzHunter-WA] Auto-continue skipped because extension is paused or autoContinue is disabled');
        return;
      }
    } catch {
      // Continue with default (enabled) if storage read fails
    }

    hasAutoClicked = true;
    console.log(`[BizzHunter-WA] Auto-clicking Continue control immediately: "${result.visibleText}"`);

    // Ensure link has text parameter
    ensureHrefCarriesText(continueElement);

    let destination = result.destinationUrl;
    if (urlInfo.text && destination && destination.includes('web.whatsapp.com') && !destination.includes('text=')) {
      const sep = destination.includes('?') ? '&' : '?';
      destination = `${destination}${sep}text=${encodeURIComponent(urlInfo.text)}`;
    }

    // Notify background that auto-continue is executing
    chrome.runtime.sendMessage({
      type: BH.MessageType.CONTINUE_PAGE_STATUS,
      payload: {
        found: true,
        isReady: true,
        visibleText: result.visibleText,
        destinationUrl: destination,
        targetType: result.targetType,
        autoTriggered: true
      }
    }).catch(() => {});

    // Brief 200ms delay to ensure page scripts have settled
    setTimeout(() => {
      try {
        if (continueElement) {
          ensureHrefCarriesText(continueElement);
          // Perform native click and dispatch synthetic event
          continueElement.click();
          continueElement.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
          }));
        }
      } catch (err) {
        console.error('[BizzHunter-WA] Error executing auto-click:', err);
      }

      // Ensure navigation fallback: if Brave popup blocker suppressed opening a new tab
      if (destination && destination.includes('web.whatsapp.com')) {
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: BH.MessageType.ENSURE_WEB_NAVIGATION,
            payload: {
              destinationUrl: destination
            }
          }).catch(() => {});
        }, 1000);
      }
    }, 200);
  }

  // 2. Observe the DOM for the Continue control
  function startDetection() {
    observerHandle = BH.observeContinueControl(document, (result) => {
      if (result.found) {
        continueElement = result.element;
        ensureHrefCarriesText(continueElement);

        if (urlInfo.text && result.destinationUrl && result.destinationUrl.includes('web.whatsapp.com') && !result.destinationUrl.includes('text=')) {
          const separator = result.destinationUrl.includes('?') ? '&' : '?';
          result.destinationUrl = `${result.destinationUrl}${separator}text=${encodeURIComponent(urlInfo.text)}`;
        }

        console.log(`[BizzHunter-WA] Continue control detected: "${result.visibleText}" -> ${result.destinationUrl || 'default'}`);

        chrome.runtime.sendMessage({
          type: BH.MessageType.CONTINUE_PAGE_STATUS,
          payload: {
            found: true,
            isReady: result.isReady,
            visibleText: result.visibleText,
            destinationUrl: result.destinationUrl,
            targetType: result.targetType,
            autoTriggered: false
          }
        }).catch(() => {});

        // Automatically click as soon as element is ready
        if (result.isReady) {
          triggerAutoContinue(result);
        }
      } else {
        console.warn(`[BizzHunter-WA] Continue control not found: ${result.reason}`);
        chrome.runtime.sendMessage({
          type: BH.MessageType.CONTINUE_PAGE_STATUS,
          payload: {
            found: false,
            isReady: false,
            reason: result.reason || 'Element not found'
          }
        }).catch(() => {});
      }
    }, 12000); // 12 second maximum observation window
  }

  // 3. Listen for user-triggered continue action from background or popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === BH.MessageType.EXECUTE_CONTINUE_CLICK) {
      handleUserContinueTrigger(sendResponse);
      return true; // async response
    }
  });

  function handleUserContinueTrigger(sendResponse) {
    // If we haven't found the element yet, run an immediate detection
    if (!continueElement) {
      const immediate = BH.detectContinueControl(document);
      if (immediate.found) {
        continueElement = immediate.element;
      }
    }

    if (continueElement) {
      try {
        ensureHrefCarriesText(continueElement);
        console.log('[BizzHunter-WA] User triggered Continue click on detected control');
        continueElement.click();
        sendResponse({ success: true, message: 'Continue element clicked successfully' });
      } catch (err) {
        console.error('[BizzHunter-WA] Failed to click continue element:', err);
        sendResponse({ success: false, error: err.message });
      }
    } else {
      sendResponse({ success: false, error: 'Continue element not available to click' });
    }
  }

  // Run detection when DOM is interactive or ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDetection);
  } else {
    startDetection();
  }

  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    if (observerHandle) {
      observerHandle.disconnect();
    }
  });

})();
