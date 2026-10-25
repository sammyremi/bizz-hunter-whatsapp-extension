/**
 * Bizz-Hunter WhatsApp Assistant - URL Parser & Validator
 * Strictly validates WhatsApp Send URLs, extracts recipient and message,
 * handles parameter permutations and encoding, and creates privacy-safe logs.
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
   * Sanitizes a phone number to digits only (strip spaces, +, -, parentheses).
   * @param {string} phone
   * @returns {string}
   */
  function normalizePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return '';
    return phone.replace(/[^0-9]/g, '');
  }

  /**
   * Mask a phone number for privacy-safe logs and UI display.
   * e.g., "2347031615407" -> "+234 •••• 407"
   * @param {string} phone
   * @returns {string}
   */
  function maskPhoneNumber(phone) {
    const clean = normalizePhoneNumber(phone);
    if (!clean) return 'Unknown';
    if (clean.length <= 4) return '•••' + clean;
    const prefix = clean.slice(0, Math.min(3, Math.floor(clean.length / 3)));
    const suffix = clean.slice(-3);
    return `+${prefix} •••• ${suffix}`;
  }

  /**
   * Generates a safe text summary (length and bounded snippet, never full sensitive text).
   * @param {string} text
   * @param {number} maxLen
   * @returns {{ length: number, snippet: string }}
   */
  function summarizeMessage(text, maxLen = 30) {
    if (!text || typeof text !== 'string') {
      return { length: 0, snippet: '' };
    }
    const clean = text.trim();
    const snippet = clean.length > maxLen
      ? clean.substring(0, maxLen).replace(/\s+/g, ' ') + '...'
      : clean.replace(/\s+/g, ' ');
    return {
      length: clean.length,
      snippet: snippet
    };
  }

  /**
   * Validates if a phone number is structurally valid for WhatsApp (between 7 and 15 digits according to E.164).
   * @param {string} phone
   * @returns {boolean}
   */
  function isValidPhoneNumber(phone) {
    const clean = normalizePhoneNumber(phone);
    return clean.length >= 7 && clean.length <= 15;
  }

  /**
   * Parses and validates a WhatsApp Send URL.
   * Accepts both `https://api.whatsapp.com/send/?...` and `https://api.whatsapp.com/send?...`
   * Also accepts `https://web.whatsapp.com/send/?...` and `https://web.whatsapp.com/send?...`
   *
   * @param {string} urlString
   * @returns {{
   *   isValid: boolean,
   *   isSendEndpoint: boolean,
   *   isWebEndpoint: boolean,
   *   phone: string,
   *   phoneNormalized: string,
   *   phoneMasked: string,
   *   text: string,
   *   textSummary: { length: number, snippet: string },
   *   error?: string
   * }}
   */
  function parseWhatsAppUrl(urlString) {
    const failureResult = (reason) => ({
      isValid: false,
      isSendEndpoint: false,
      isWebEndpoint: false,
      phone: '',
      phoneNormalized: '',
      phoneMasked: '',
      text: '',
      textSummary: { length: 0, snippet: '' },
      error: reason
    });

    if (!urlString || typeof urlString !== 'string') {
      return failureResult('Empty or non-string URL');
    }

    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      return failureResult('Malformed URL');
    }

    const host = parsed.hostname.toLowerCase();
    const isApiHost = host === 'api.whatsapp.com';
    const isWebHost = host === 'web.whatsapp.com';

    // Must be either api.whatsapp.com or web.whatsapp.com
    if (!isApiHost && !isWebHost) {
      return failureResult(`Unrelated host: ${host}`);
    }

    // Path must start with /send or /send/
    const pathname = parsed.pathname.toLowerCase();
    const isSendPath = pathname === '/send' || pathname === '/send/' || pathname.startsWith('/send/');

    if (!isSendPath) {
      return failureResult(`Non-send path: ${pathname}`);
    }

    // Extract query parameters regardless of order
    const params = parsed.searchParams;
    const rawPhone = params.get('phone') || '';
    const rawText = params.get('text') || '';

    const phoneNormalized = normalizePhoneNumber(rawPhone);

    if (!phoneNormalized) {
      return failureResult('Missing phone parameter');
    }

    if (!isValidPhoneNumber(phoneNormalized)) {
      return failureResult(`Invalid phone length (${phoneNormalized.length} digits)`);
    }

    // Text may be empty if not provided, but Bizz-Hunter prepares personalized text
    const textSummary = summarizeMessage(rawText);

    return {
      isValid: true,
      isSendEndpoint: isApiHost,
      isWebEndpoint: isWebHost,
      phone: rawPhone,
      phoneNormalized: phoneNormalized,
      phoneMasked: maskPhoneNumber(phoneNormalized),
      text: rawText,
      textSummary: textSummary,
      rawUrl: parsed.origin + parsed.pathname
    };
  }

  /**
   * Check if a URL belongs to WhatsApp Web (either initial send or the main application).
   * @param {string} urlString
   * @returns {boolean}
   */
  function isWhatsAppWebUrl(urlString) {
    if (!urlString || typeof urlString !== 'string') return false;
    try {
      const parsed = new URL(urlString);
      return parsed.hostname.toLowerCase() === 'web.whatsapp.com';
    } catch {
      return false;
    }
  }

  return {
    normalizePhoneNumber,
    maskPhoneNumber,
    summarizeMessage,
    isValidPhoneNumber,
    parseWhatsAppUrl,
    isWhatsAppWebUrl
  };
});
