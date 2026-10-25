/**
 * Test Suite: URL Parser & Validator
 * Tests cases 1, 2, 3, 4:
 * - Valid api.whatsapp.com/send/ URL
 * - Parameter order independence & URL decoding
 * - Missing or invalid phone numbers
 * - Missing message parameters
 * - Unrelated URLs and paths
 * - Phone masking and privacy safeguards
 */

const assert = require('assert');
const BH = require('../shared/url_parser.js');

function runTests() {
  console.log('\n--- Running URL Parser Tests ---');
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

  // 1. Valid URL with phone and message
  test('Parses valid WhatsApp send URL with phone and text', () => {
    const url = 'https://api.whatsapp.com/send/?phone=2347031615407&text=Hello%20World&type=phone_number&app_absent=0';
    const res = BH.parseWhatsAppUrl(url);

    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.isSendEndpoint, true);
    assert.strictEqual(res.phoneNormalized, '2347031615407');
    assert.strictEqual(res.text, 'Hello World');
    assert.strictEqual(res.textSummary.length, 11);
    assert.strictEqual(res.phoneMasked, '+234 •••• 407');
  });

  // 2. Query parameter order independence
  test('Handles query parameters regardless of their order', () => {
    const url = 'https://api.whatsapp.com/send/?type=phone_number&text=Custom%20Pitch&app_absent=0&phone=14155552671';
    const res = BH.parseWhatsAppUrl(url);

    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.phoneNormalized, '14155552671');
    assert.strictEqual(res.text, 'Custom Pitch');
    assert.strictEqual(res.phoneMasked, '+141 •••• 671');
  });

  // 3. Alternate path /send without trailing slash
  test('Handles /send path without trailing slash', () => {
    const url = 'https://api.whatsapp.com/send?phone=447911123456&text=Test';
    const res = BH.parseWhatsAppUrl(url);

    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.phoneNormalized, '447911123456');
    assert.strictEqual(res.text, 'Test');
  });

  // 4. Missing phone parameter
  test('Rejects URL missing phone parameter', () => {
    const url = 'https://api.whatsapp.com/send/?text=Hello';
    const res = BH.parseWhatsAppUrl(url);

    assert.strictEqual(res.isValid, false);
    assert.match(res.error, /missing phone/i);
  });

  // 5. Invalid / too short phone parameter
  test('Rejects URL with invalid / too short phone parameter', () => {
    const url = 'https://api.whatsapp.com/send/?phone=123&text=Hello';
    const res = BH.parseWhatsAppUrl(url);

    assert.strictEqual(res.isValid, false);
    assert.match(res.error, /invalid phone/i);
  });

  // 6. Missing text parameter (valid URL, empty draft)
  test('Accepts URL with missing or empty text parameter', () => {
    const url = 'https://api.whatsapp.com/send/?phone=2347031615407';
    const res = BH.parseWhatsAppUrl(url);

    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.text, '');
    assert.strictEqual(res.textSummary.length, 0);
  });

  // 7. Unrelated hostnames
  test('Rejects unrelated hostnames (e.g. google.com or bizzhunter.com)', () => {
    const url = 'https://google.com/send/?phone=2347031615407&text=Hello';
    const res = BH.parseWhatsAppUrl(url);

    assert.strictEqual(res.isValid, false);
    assert.match(res.error, /unrelated host/i);
  });

  // 8. Unrelated WhatsApp paths
  test('Rejects non-send WhatsApp paths (e.g. /about or /download)', () => {
    const url = 'https://api.whatsapp.com/about?phone=2347031615407';
    const res = BH.parseWhatsAppUrl(url);

    assert.strictEqual(res.isValid, false);
    assert.match(res.error, /non-send path/i);
  });

  // 9. Phone with special symbols (+, dashes, spaces)
  test('Normalizes phone numbers containing +, dashes, or spaces', () => {
    const url = 'https://api.whatsapp.com/send/?phone=%2B1%20(415)%20555-2671&text=Hello';
    const res = BH.parseWhatsAppUrl(url);

    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.phoneNormalized, '14155552671');
  });

  // 10. Privacy: Text summary never exposes unbounded sensitive text
  test('Summarizes long text with a bounded snippet and length', () => {
    const longText = 'A'.repeat(200);
    const summary = BH.summarizeMessage(longText, 25);

    assert.strictEqual(summary.length, 200);
    assert.strictEqual(summary.snippet.length, 28); // 25 + '...'
    assert.ok(summary.snippet.endsWith('...'));
  });

  return { passed, failed };
}

if (require.main === module) {
  const { passed, failed } = runTests();
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = runTests;
