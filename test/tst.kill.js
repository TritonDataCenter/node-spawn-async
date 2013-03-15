/*
 * tst.kill.js: tests case where the worker child process dies unexpectedly
 */

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

worker.aspawn(['sleep', '10'], function (err) {
	mod_assert.ok(err);
	mod_assert.equal(err.message, 'worker process exited unexpectedly');

	worker.aspawn([ 'echo', 'hello' ], function (err2, stdout, stderr) {
		mod_assert.ok(!err2);
		mod_assert.equal(stdout, 'hello\n');

		/* Try the same thing across a "destroy". */
		worker.aspawn([ 'sleep', '10' ], function (err3) {
			mod_assert.ok(err3);
			mod_assert.equal(err3.message,
			    'worker process was destroyed');
			log.info('TEST PASSED');
		});

		worker.destroy();
	});
});

process.kill(worker.w_child.pid, 'SIGKILL');
