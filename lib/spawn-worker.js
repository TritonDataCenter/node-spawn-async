/*
 * spawn-worker.js: worker process.  This implementation is tightly coupled with
 * the parent process so we don't bother doing much validation.
 */

var mod_assert = require('assert');
var mod_child = require('child_process');

var pending = {};

process.on('message', function (message) {
	mod_assert.ok(!pending.hasOwnProperty(message['id']));

	pending[message['id']] = {
	    'started': new Date(),
	    'cmd': message
	};

	var argv = message['argv'];
	mod_child.execFile(argv[0], argv.slice(1), {
	    'env': message['env'],
	    'encoding': 'utf8'
	}, function (err, stdout, stderr) {
		delete (pending[message['id']]);
		process.send({
		    'id': message['id'],
		    'stdout': stdout,
		    'stderr': stderr,
		    'code': err ? err['code'] : 0,
		    'signal': err ? err['signal'] : null
		});
	});
});
