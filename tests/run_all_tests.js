/**
 * Bizz-Hunter WhatsApp Assistant - Test Suite Runner
 * Runs all automated tests across URL parsing, DOM detection, and state machine lifecycles.
 */

const runUrlParserTests = require('./url_parser.test.js');
const runSendDetectorTests = require('./send_detector.test.js');
const runWebDetectorTests = require('./web_detector.test.js');
const runStateMachineTests = require('./state_machine.test.js');
const runRegressionTests = require('./regression_composer_prefill.test.js');
const runContinueNavigationTests = require('./continue_navigation_flow.test.js');
const runAutoSendTests = require('./auto_send_flow.test.js');

async function main() {
  console.log('====================================================');
  console.log('   Bizz-Hunter WhatsApp Extension Automated Tests   ');
  console.log('====================================================');

  let totalPassed = 0;
  let totalFailed = 0;

  try {
    const res1 = runUrlParserTests();
    totalPassed += res1.passed;
    totalFailed += res1.failed;

    const res2 = runSendDetectorTests();
    totalPassed += res2.passed;
    totalFailed += res2.failed;

    const res3 = runWebDetectorTests();
    totalPassed += res3.passed;
    totalFailed += res3.failed;

    const res4 = await runStateMachineTests();
    totalPassed += res4.passed;
    totalFailed += res4.failed;

    const res5 = await runRegressionTests();
    totalPassed += res5.passed;
    totalFailed += res5.failed;

    const res6 = await runContinueNavigationTests();
    totalPassed += res6.passed;
    totalFailed += res6.failed;

    const res7 = await runAutoSendTests();
    totalPassed += res7.passed;
    totalFailed += res7.failed;
  } catch (err) {
    console.error('Fatal test runner error:', err);
    process.exit(1);
  }

  console.log('\n====================================================');
  console.log(`Results: ${totalPassed} Passed, ${totalFailed} Failed`);
  console.log('====================================================');

  if (totalFailed > 0) {
    console.error('❌ Some tests failed.');
    process.exit(1);
  } else {
    console.log('✅ ALL TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
  }
}

main();
