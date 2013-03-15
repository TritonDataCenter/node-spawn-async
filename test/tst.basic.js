var mod_assert = require('assert');
var mod_bunyan = require('bunyan');
var mod_path = require('path');
var mod_spawnasync = require('../lib/spawn-async.js');

var log, worker, npending;

log = new mod_bunyan({
    'name': mod_path.basename(process.argv[1]),
    'level': process.env['LOG_LEVEL'] || 'debug'
});

log.info('starting test');
worker = mod_spawnasync.createWorker({ 'log': log });
npending = 1;

/*
 * Test invalid arguments.
 */
/* BEGIN JSSTYLED */
mod_assert.throws(function () { worker.aspawn(); },
    /"argv" must be non-empty array of strings/);
mod_assert.throws(function () { worker.aspawn([]); },
    /"argv" must be non-empty array of strings/);
mod_assert.throws(function () { worker.aspawn([ true ]); },
    /"argv\[0\]" \(true\) is not a string/);
mod_assert.throws(function () { worker.aspawn([ 'hello' ]); },
    /"callback" must be a function/);
mod_assert.throws(function () {
    worker.aspawn([ 'hello' ], true, function () {}); },
    /"options" must be an object/);
/* END JSSTYLED */

/*
 * Test basic execution.
 */
++npending;
worker.aspawn([ 'echo', 'hello world' ], function (err, stdout, stderr) {
	mod_assert.ok(!err);
	mod_assert.equal(stdout, 'hello world\n');
	mod_assert.equal(stderr, '');
	checkDone();
});

/*
 * Test that by default, the child sees our environment.
 */
++npending;
mod_assert.ok(process.env['USER'], '"USER" must be set in environment');
worker.aspawn([ 'bash', '-c', 'echo $USER' ], function (err, stdout, stderr) {
	mod_assert.ok(!err);
	mod_assert.equal(stdout, process.env['USER'] + '\n');
	mod_assert.equal(stderr, '');
	checkDone();
});

/*
 * Test a custom environment.
 */
++npending;
worker.aspawn([ 'env' ], {
    'env': {
	'USER': 'someone_else'
    }
}, function (err, stdout, stderr) {
	mod_assert.ok(!err);
	mod_assert.equal(stdout, 'USER=someone_else\n');
	mod_assert.equal(stderr, '');
	checkDone();
});

/*
 * Test stderr and error cases.
 */
++npending;
worker.aspawn([ 'grep' ], function (err, stdout, stderr) {
	mod_assert.ok(err);
	mod_assert.equal(err.message, 'child exited with status 2');
	mod_assert.equal(err.code, 2);
	mod_assert.equal(stdout, '');
	mod_assert.equal(stderr.substr(0, 'Usage: grep '.length),
	    'Usage: grep ');
	checkDone();
});

/*
 * Test child killed by signal.
 */
++npending;
worker.aspawn([ 'node', '-e', 'console.log("out"); console.error("err");' +
    'process.kill(process.pid, "SIGUSR2")' ], function (err, stdout, stderr) {
	mod_assert.ok(err);
	mod_assert.equal(err.message, 'child killed by signal SIGUSR2');
	mod_assert.equal(err.signal, 'SIGUSR2');
	mod_assert.equal(stdout, 'out\n');
	mod_assert.equal(stderr, 'err\n');
	checkDone();
});

checkDone();

function checkDone()
{
	if (--npending === 0) {
		log.info('TEST PASSED');
		worker.destroy();
	}
}
