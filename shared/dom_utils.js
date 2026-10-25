/**
 * Bizz-Hunter WhatsApp Assistant - DOM Utilities
 * Robust, resilient DOM inspection routines for api.whatsapp.com and web.whatsapp.com.
 * Avoids fragile class names and handles dynamic rendering, duplicate IDs, and accessible variants.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BH = root.BH || {};
    Object.assign(root.BH, factory());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Check if an element is visible in the viewport and not hidden by styles.
   * @param {Element} el
   * @returns {boolean}
   */
  function isElementVisible(el) {
    if (!el || !el.ownerDocument) return false;
    // Check basic node visibility
    if (el.nodeType !== 1) return false;

    // Check inline/element styles directly
    if (el.style) {
      if (el.style.display === 'none') return false;
      if (el.style.visibility === 'hidden' || el.style.visibility === 'collapse') return false;
      if (el.style.opacity === '0' || el.style.opacity === 0) return false;
    }

    // Check computed styles if window is available
    const win = el.ownerDocument.defaultView || (typeof window !== 'undefined' ? window : null);
    const style = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
    if (style) {
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      if (parseFloat(style.opacity) === 0) return false;
    }

    // Check dimensions if available
    if (typeof el.getBoundingClientRect === 'function') {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        // Could be zero size if not yet rendered or hidden
        if (el.offsetParent === null && style && style.position !== 'fixed') {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Normalizes text content: strips extra whitespace, lowercases.
   * @param {string} str
   * @returns {string}
   */
  function normalizeText(str) {
    if (!str) return '';
    return str.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * Inspects the DOM on api.whatsapp.com/send to find the Continue to WhatsApp Web element.
   *
   * Strategy:
   * 1. Query all potential links and buttons (handles duplicate IDs gracefully).
   * 2. Check for explicit Web WhatsApp links (href containing web.whatsapp.com).
   * 3. Check for matching text (e.g. "Continue to WhatsApp Web", "use WhatsApp Web", "Continue to Chat").
   * 4. Check for #action-button with fallback check if it points to desktop app.
   *
   * @param {Document} doc
   * @returns {{
   *   found: boolean,
   *   element: Element|null,
   *   targetType: 'web'|'desktop'|'unknown',
   *   destinationUrl: string,
   *   visibleText: string,
   *   isReady: boolean,
   *   reason?: string
   * }}
   */
  function detectContinueControl(doc) {
    if (!doc) {
      return { found: false, element: null, targetType: 'unknown', destinationUrl: '', visibleText: '', isReady: false, reason: 'Document unavailable' };
    }

    // Known positive text keywords
    const webKeywords = [
      'continue to whatsapp web',
      'use whatsapp web',
      'whatsapp web',
      'continue to chat'
    ];

    // Priority 1: Elements pointing directly to web.whatsapp.com
    const webAnchors = Array.from(doc.querySelectorAll('a[href*="web.whatsapp.com"]'));
    for (const anchor of webAnchors) {
      if (isElementVisible(anchor)) {
        const text = anchor.textContent ? anchor.textContent.trim() : '';
        const href = anchor.getAttribute('href') || '';
        return {
          found: true,
          element: anchor,
          targetType: 'web',
          destinationUrl: href,
          visibleText: text || 'Continue to WhatsApp Web',
          isReady: !anchor.hasAttribute('disabled') && !(anchor.classList && anchor.classList.contains && anchor.classList.contains('disabled'))
        };
      }
    }

    // Priority 2: Elements with id="action-button" (WhatsApp's primary action button)
    // Query all elements with this ID to handle duplicate IDs
    const actionButtons = Array.from(doc.querySelectorAll('[id="action-button"]'));
    for (const btn of actionButtons) {
      if (isElementVisible(btn)) {
        const href = btn.getAttribute('href') || '';
        const text = btn.textContent ? btn.textContent.trim() : '';
        const normText = normalizeText(text);

        // Check if this action button directly points to web
        if (href.includes('web.whatsapp.com') || webKeywords.some(kw => normText.includes(kw))) {
          return {
            found: true,
            element: btn,
            targetType: 'web',
            destinationUrl: href,
            visibleText: text,
            isReady: !btn.hasAttribute('disabled')
          };
        }

        // If it points to whatsapp:// or desktop protocol, look for secondary web fallback
        if (href.startsWith('whatsapp://') || href.startsWith('intent://')) {
          // Check for fallback link near or below this button
          const fallback = doc.querySelector('a[href*="web.whatsapp.com"], a._9v6b, a[role="link"]');
          if (fallback && isElementVisible(fallback)) {
            const fallbackHref = fallback.getAttribute('href') || '';
            const fallbackText = fallback.textContent ? fallback.textContent.trim() : '';
            return {
              found: true,
              element: fallback,
              targetType: 'web',
              destinationUrl: fallbackHref,
              visibleText: fallbackText || 'use WhatsApp Web',
              isReady: true
            };
          }
        }
      }
    }

    // Priority 3: Any visible anchor or button matching visible text variations
    const candidates = Array.from(doc.querySelectorAll('a, button, [role="link"], [role="button"]'));
    for (const el of candidates) {
      if (!isElementVisible(el)) continue;

      const text = el.textContent ? el.textContent.trim() : '';
      const normText = normalizeText(text);
      const ariaLabel = normalizeText(el.getAttribute('aria-label') || '');

      const isMatch = webKeywords.some(kw => normText.includes(kw) || ariaLabel.includes(kw));
      if (isMatch) {
        const href = el.getAttribute('href') || '';
        return {
          found: true,
          element: el,
          targetType: href.includes('web.whatsapp.com') ? 'web' : 'unknown',
          destinationUrl: href,
          visibleText: text,
          isReady: !el.hasAttribute('disabled')
        };
      }
    }

    return {
      found: false,
      element: null,
      targetType: 'unknown',
      destinationUrl: '',
      visibleText: '',
      isReady: false,
      reason: 'No matching Continue control found in current DOM'
    };
  }

  /**
   * Watches for the Continue button on api.whatsapp.com using MutationObserver.
   * Self-terminates on success or after timeout.
   *
   * @param {Document} doc
   * @param {Function} onDetected - callback({ found, element, targetType, destinationUrl, visibleText })
   * @param {number} timeoutMs - Max time to observe before reporting failure (default 10000ms)
   * @returns {{ disconnect: Function }}
   */
  function observeContinueControl(doc, onDetected, timeoutMs = 10000) {
    if (!doc || !doc.body) {
      // If body not ready, try on DOMContentLoaded or immediate check
      return { disconnect: () => {} };
    }

    // Initial check
    const initialResult = detectContinueControl(doc);
    if (initialResult.found) {
      onDetected(initialResult);
      return { disconnect: () => {} };
    }

    let observer = null;
    let timer = null;

    const cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    timer = setTimeout(() => {
      cleanup();
      // Final check upon timeout
      const finalResult = detectContinueControl(doc);
      onDetected(finalResult);
    }, timeoutMs);

    observer = new MutationObserver(() => {
      const res = detectContinueControl(doc);
      if (res.found) {
        cleanup();
        onDetected(res);
      }
    });

    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'style', 'class', 'disabled']
    });

    return { disconnect: cleanup };
  }

  /**
   * WhatsApp Web DOM Inspection.
   * Detects active chat state, header recipient, composer draft, and modals.
   *
   * @param {Document} doc
   * @param {string} [expectedPhone] - Optional expected phone number to verify against
   * @returns {{
   *   isAppLoaded: boolean,
   *   isConnecting: boolean,
   *   isQrScreen: boolean,
   *   isInvalidNumber: boolean,
   *   invalidNumberMessage: string,
   *   chatOpen: boolean,
   *   recipientText: string,
   *   recipientVerified: boolean,
   *   composerFound: boolean,
   *   composerElement: Element|null,
   *   draftText: string,
   *   hasDraft: boolean,
   *   sendButtonFound: boolean,
   *   sendButtonElement: Element|null
   * }}
   */
  function inspectWhatsAppWeb(doc, expectedPhone = '') {
    const result = {
      isAppLoaded: false,
      isConnecting: false,
      isQrScreen: false,
      isInvalidNumber: false,
      invalidNumberMessage: '',
      chatOpen: false,
      recipientText: '',
      recipientVerified: false,
      composerFound: false,
      composerElement: null,
      draftText: '',
      hasDraft: false,
      sendButtonFound: false,
      sendButtonElement: null
    };

    if (!doc) return result;

    const bodyText = doc.body ? doc.body.textContent || '' : '';

    // Check if connecting/loading
    if (doc.querySelector('progress, [aria-busy="true"], .progress') ||
        bodyText.includes('Connecting to WhatsApp') ||
        bodyText.includes('Starting chat') ||
        bodyText.includes('Loading your chats')) {
      result.isConnecting = true;
    }

    // Check QR code screen (user not logged in)
    if (doc.querySelector('canvas[aria-label*="Scan"], canvas[role="img"]') ||
        bodyText.includes('To use WhatsApp on your computer') ||
        bodyText.includes('Link with phone number')) {
      result.isQrScreen = true;
      return result;
    }

    // Check invalid phone number popup / modal
    // WhatsApp displays a modal: "Phone number shared via url is invalid." or "The phone number is not registered on WhatsApp."
    const modal = doc.querySelector('div[data-animate-modal-popup="true"], div[role="dialog"]');
    if (modal) {
      const modalText = modal.textContent || '';
      if (modalText.includes('invalid') || modalText.includes('not registered') || modalText.includes('shared via url is invalid')) {
        result.isInvalidNumber = true;
        result.invalidNumberMessage = modalText.replace(/\s+/g, ' ').trim();
        return result;
      }
    }

    // Check "Use Here" dialog (when WhatsApp is open in another window)
    const useHereModal = doc.querySelector('div[data-animate-modal-popup="true"], div[role="dialog"]');
    if (useHereModal) {
      const modalText = useHereModal.textContent || '';
      if (modalText.includes('open in another window') || modalText.includes('Use Here')) {
        const useHereBtn = useHereModal.querySelector('button, div[role="button"]');
        result.isUseHerePrompt = true;
        result.useHereButtonElement = useHereBtn;
      }
    }

    // Main App Container check
    const appEl = doc.getElementById('app') || doc.querySelector('#main, [data-testid="conversation-panel-wrapper"], div[role="region"]');
    if (appEl) {
      result.isAppLoaded = true;
    }

    // Detect Conversation Header and Recipient
    // WhatsApp Web puts the active chat header inside a <header> element or [data-testid="conversation-header"]
    const header = doc.querySelector('#main header, [data-testid="conversation-header"], header[data-testid="chat-header"]');
    const safeHeader = header || Array.from(doc.querySelectorAll('header')).find(h => !h.closest || !h.closest('#side'));

    if (safeHeader) {
      result.chatOpen = true;

      // Extract recipient text from header title/spans
      const titleSpan = safeHeader.querySelector('span[title], div[role="button"] span[dir="auto"], span._ao3e');
      if (titleSpan) {
        result.recipientText = (titleSpan.getAttribute('title') || titleSpan.textContent || '').trim();
      } else {
        const anySpan = safeHeader.querySelector('span[dir="auto"]');
        if (anySpan) {
          result.recipientText = (anySpan.textContent || '').trim();
        }
      }

      // Verify recipient against expected phone if provided
      if (expectedPhone && result.recipientText) {
        const cleanExpected = expectedPhone.replace(/[^0-9]/g, '');
        const cleanFound = result.recipientText.replace(/[^0-9]/g, '');
        // Check if last 7 digits match (handles international prefixes vs local format)
        if (cleanExpected.length >= 7 && cleanFound.length >= 7) {
          const suffixExpected = cleanExpected.slice(-7);
          const suffixFound = cleanFound.slice(-7);
          result.recipientVerified = (suffixExpected === suffixFound) || cleanFound.includes(suffixExpected) || cleanExpected.includes(cleanFound);
        } else if (cleanExpected && cleanFound) {
          result.recipientVerified = cleanFound.includes(cleanExpected) || cleanExpected.includes(cleanFound);
        }
      }
    }

    // Detect Message Composer
    // Crucial rule: Message composer is in the active chat container (#main or footer).
    // Supports Lexical editor (data-lexical-editor="true"), data-tab="10", role="textbox".
    // Explicitly avoids search input in sidebar (#side / data-tab="3") and message bubbles.
    let composer = null;
    const mainArea = doc.getElementById('main') || doc.querySelector('[data-testid="conversation-panel-wrapper"]');

    if (mainArea) {
      composer = mainArea.querySelector(
        'div[contenteditable="true"][data-lexical-editor="true"], ' +
        'div[contenteditable="true"][data-tab="10"], ' +
        'div[contenteditable="true"][role="textbox"], ' +
        'footer div[contenteditable="true"], ' +
        'div[contenteditable="true"]'
      );
    }

    if (!composer) {
      const footer = doc.querySelector('#main footer, [data-testid="conversation-panel-wrapper"] footer, footer');
      if (footer && (!footer.closest || !footer.closest('#side'))) {
        composer = footer.querySelector('div[contenteditable="true"]');
      }
    }

    if (!composer) {
      const candidateTextboxes = Array.from(doc.querySelectorAll('div[contenteditable="true"]'));
      for (const tb of candidateTextboxes) {
        if ((!tb.closest || !tb.closest('#side')) &&
            (!tb.closest || !tb.closest('[data-testid="chat-list-search"]')) &&
            (!tb.closest || !tb.closest('[data-tab="3"]')) &&
            (!tb.closest || !tb.closest('[data-testid="conversation-panel-messages"]'))) {
          composer = tb;
          break;
        }
      }
    }

    if (composer && isElementVisible(composer)) {
      result.composerFound = true;
      result.composerElement = composer;
      result.chatOpen = true; // Composer in chat confirms chat is open

      // Extract text content safely from the composer, stripping zero-width spaces
      const composerText = composer.innerText || composer.textContent || '';
      const cleanDraft = stripZeroWidth(composerText);

      result.draftText = cleanDraft;
      result.hasDraft = cleanDraft.length > 0;

      // Detect Send Button
      const sendBtn = (mainArea || doc).querySelector(
        'button[data-testid="compose-btn-send"], [data-icon="send"], button span[data-icon="send"]'
      );

      if (sendBtn) {
        result.sendButtonFound = true;
        result.sendButtonElement = sendBtn.tagName.toLowerCase() === 'button'
          ? sendBtn
          : sendBtn.closest('button') || sendBtn;
      }
    }

    return result;
  }

  /**
   * Helper to strip zero-width spaces and control characters from text strings.
   * @param {string} str
   * @returns {string}
   */
  function stripZeroWidth(str) {
    if (!str) return '';
    return str.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  }

  /**
   * Focuses an element and places the caret selection at the very end.
   * @param {Element} el
   */
  function focusAndPlaceCursorAtEnd(el) {
    if (!el) return;
    try {
      const doc = el.ownerDocument || document;
      const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
      if (win && typeof win.focus === 'function') win.focus();
      el.focus();

      if (win && win.getSelection && doc.createRange) {
        const sel = win.getSelection();
        const range = doc.createRange();
        const textTarget = el.querySelector('span[data-lexical-text="true"]') || el.querySelector('p') || el;
        range.selectNodeContents(textTarget);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {}
  }

  /**
   * Inserts text directly into WhatsApp Web's Lexical composer.
   * Utilizes execCommand('insertText') (which triggers native Chromium beforeinput events that Lexical listens to),
   * followed by synthetic InputEvents and paste fallbacks.
   *
   * @param {Element} composerEl - contenteditable element
   * @param {string} messageText - text to insert
   * @returns {boolean} - true if text was successfully inserted
   */
  function insertMessageIntoComposer(composerEl, messageText) {
    if (!composerEl || !messageText) return false;

    // Check if composer already contains the exact message or part of it
    const initialRaw = composerEl.innerText || composerEl.textContent || '';
    const initialClean = stripZeroWidth(initialRaw);
    if (initialClean === messageText || initialClean.includes(messageText)) {
      focusAndPlaceCursorAtEnd(composerEl);
      return true;
    }

    const doc = composerEl.ownerDocument || document;
    const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);

    // 1. Focus the window and the composer element
    try {
      if (win && typeof win.focus === 'function') win.focus();
      composerEl.focus();
    } catch {}

    // 2. Position cursor range inside the editor
    if (win && win.getSelection && doc.createRange) {
      try {
        const sel = win.getSelection();
        const range = doc.createRange();
        const p = composerEl.querySelector('p') || composerEl;
        range.selectNodeContents(p);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {}
    }

    // 3. Strategy 1: document.execCommand('insertText', false, messageText)
    // In Chromium, execCommand on a focused contenteditable triggers a trusted native
    // 'beforeinput' event with inputType 'insertText', which Meta Lexical binds to directly.
    if (doc && typeof doc.execCommand === 'function') {
      try {
        doc.execCommand('insertText', false, messageText);
      } catch (err) {
        console.warn('[BizzHunter-WA] execCommand insertText error:', err);
      }
    }

    // Verify if Strategy 1 populated the text
    let currentClean = stripZeroWidth(composerEl.innerText || composerEl.textContent || '');

    // 4. Strategy 2: Synthetic InputEvent pipeline (beforeinput + input)
    if (!currentClean || currentClean.length === 0) {
      try {
        if (typeof InputEvent !== 'undefined' && typeof composerEl.dispatchEvent === 'function') {
          composerEl.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: messageText
          }));
        }

        // Direct DOM structure reinforcement for Lexical:
        let p = composerEl.querySelector('p');
        if (!p) {
          p = doc.createElement('p');
          p.className = 'selectable-text copyable-text';
          composerEl.appendChild(p);
        }

        let span = p.querySelector('span[data-lexical-text="true"]') || p.querySelector('span');
        if (!span) {
          span = doc.createElement('span');
          span.setAttribute('data-lexical-text', 'true');
          p.appendChild(span);
        }
        span.textContent = messageText;
        p.textContent = messageText;
        composerEl.textContent = messageText;
        composerEl.innerText = messageText;

        if (typeof InputEvent !== 'undefined' && typeof composerEl.dispatchEvent === 'function') {
          composerEl.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: messageText
          }));
        }
        if (typeof Event !== 'undefined' && typeof composerEl.dispatchEvent === 'function') {
          composerEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch (err) {
        console.warn('[BizzHunter-WA] InputEvent fallback error:', err);
      }
    }

    // 5. Strategy 3: ClipboardEvent 'paste' fallback
    currentClean = stripZeroWidth(composerEl.innerText || composerEl.textContent || '');
    if ((!currentClean || currentClean.length === 0) && typeof ClipboardEvent !== 'undefined' && typeof DataTransfer !== 'undefined') {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', messageText);
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true
        });
        if (typeof composerEl.dispatchEvent === 'function') {
          composerEl.dispatchEvent(pasteEvent);
        }
      } catch (err) {
        console.warn('[BizzHunter-WA] DataTransfer paste error:', err);
      }
    }

    // 6. Caret adjustment: focus and collapse selection to the very end of the message
    focusAndPlaceCursorAtEnd(composerEl);

    // Final check
    const finalClean = stripZeroWidth(composerEl.innerText || composerEl.textContent || '');
    return finalClean.length > 0;
  }

  return {
    isElementVisible,
    normalizeText,
    stripZeroWidth,
    focusAndPlaceCursorAtEnd,
    detectContinueControl,
    observeContinueControl,
    inspectWhatsAppWeb,
    insertMessageIntoComposer
  };
});
