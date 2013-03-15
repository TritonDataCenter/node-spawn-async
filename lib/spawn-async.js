/*
 * spawn-async.js: asynchronous spawn functions
 */

var mod_assert = require('assert');
var mod_child = require('child_process');
var mod_events = require('events');
var mod_path = require('path');
var mod_util = require('util');

var EventEmitter = mod_events.EventEmitter;

var WORKER_EXEC = mod_path.join(__dirname, 'spawn-worker.js');

/* Public interface */
exports.createWorker = createWorker;

function createWorker(args)
{
	mod_assert.ok(typeof (args) === 'object' &&
	    args['log'] !== undefined, '"log" argument is required');

	var w = new Worker(args['log']);
	w.start();
	return (w);
}

/*
 * The Worker object wraps a child process from which we fork all other child
 * processes.  We communicate using Node's built-in parent-child event channel.
 * This approach is quick to implement, but if this becomes problematic for
 * stability, the child process could be made a native binary.
 */
function Worker(log)
{
	EventEmitter.call(this);

	this.w_child = undefined;
	this.w_destroyed = false;
	this.w_log = log;
	this.w_id = 0;
	this.w_pending = {};
	this.w_starts = 0;
}

mod_util.inherits(Worker, EventEmitter);

/*
 * [private] Start the child process.
 */
Worker.prototype.start = function ()
{
	this.w_starts++;
	this.w_log.info('forking worker process');
	this.w_child = mod_child.fork(WORKER_EXEC);
	this.w_child.on('exit', this.onChildExit.bind(this));
	this.w_child.on('message', this.onChildMessage.bind(this));

	/*
	 * We shouldn't need to worry about the child sticking around after this
	 * process exits, whether we exit normally or not, because a Node child
	 * process exits when it discovers that it's parent is not connected any
	 * more.
	 */
};

/*
 * [private] Invoked when the worker process exits for any reason.  Fails any
 * pending commands.  If the user has called destroy(), then we're done.
 * Otherwise, restart the child process.
 */
Worker.prototype.onChildExit = function (code, signal)
{
	var expected, id, cmd;

	expected = this.w_destroyed;
	this.w_log.info('worker process exited %s',
	    expected ? '(destroyed)' : 'unexpectedly', code, signal);
	this.w_child = undefined;

	if (expected) {
		this.emit('exit');
	} else {
		this.emit('exit',
		    new Error('child unexpectedly exited with ' +
		    code ? ('code ' + code) : ('signal ' + signal)));
		this.start();
	}

	for (id in this.w_pending) {
		cmd = this.w_pending[id];
		this.w_log.debug('command aborted', cmd);
		cmd['callback'](new Error('worker process ' +
		    (expected ? 'was destroyed' : 'exited unexpectedly')));
		delete (this.w_pending[id]);
	}
};

/*
 * [private] Invoked when the worker process sends us a message, which should
 * only be when it has completed a command.
 */
Worker.prototype.onChildMessage = function (message)
{
	if (typeof (message) != 'object' ||
	    message['id'] === undefined ||
	    message['stdout'] === undefined ||
	    message['stderr'] === undefined) {
		this.w_log.warn('unrecognized child message', message);
		return;
	}

	if (!this.w_pending.hasOwnProperty(message['id'])) {
		this.w_log.warn('unknown command in child message', message);
		return;
	}

	var error, callback;

	this.w_log.debug('command completed', message);

	if (message['code'] === 0) {
		error = null;
	} else if (typeof (message['code']) === 'number') {
		error = new Error('child exited with status ' +
		    message['code']);
		error['code'] = message['code'];
	} else if (message['signal'] !== undefined) {
		error = new Error('child killed by signal ' +
		    message['signal']);
		error['signal'] = message['signal'];
	} else {
		error = new Error('unknown error');
	}

	callback = this.w_pending[message['id']]['callback'];
	callback(error, message['stdout'], message['stderr']);
	delete (this.w_pending[message['id']]);
};

/*
 * Spawns a new child to execute the command specified by "argv".  See README.md
 * for details.
 */
Worker.prototype.aspawn = function (argv, options, callback)
{
	mod_assert.ok(this.w_child !== undefined,
	    'worker process is not running');

	/* Validate arguments. */
	if (arguments.length < 3) {
		callback = options;
		options = {};
	}

	mod_assert.ok(Array.isArray(argv) && argv.length > 0,
	    '"argv" must be non-empty array of strings');
	argv.forEach(function (arg, i) {
		mod_assert.ok(typeof (arg) == 'string',
		    '"argv[' + i + ']" (' + arg.toString() + ') ' +
		    'is not a string');
	});
	mod_assert.ok(typeof (options) == 'object',
	    '"options" must be an object');
	mod_assert.ok(callback instanceof Function,
	    '"callback" must be a function');

	/* Defensively copy arguments. */
	var command, srcenv, key;
	command = {
	    'id': ++this.w_id,
	    'argv': argv.slice(0),
	    'env': {}
	};
	srcenv = options['env'] || process.env;
	for (key in srcenv)
		command['env'][key] = srcenv[key];

	/* Issue command. */
	this.w_log.debug('issuing command', command);

	this.w_pending[command['id']] = {
	    'cmd': command,
	    'started': new Date(),
	    'callback': callback
	};

	this.w_child.send(command);
};

/*
 * Fail any pending commands and destroy resources associated with this object
 * (including the worker process).
 */
Worker.prototype.destroy = function ()
{
	/* "destroy" is idempotent. */
	if (this.w_child === undefined)
		return;

	/*
	 * Kill the child process.  Everything else gets cleaned up when the
	 * child exited, since we have to handle that case anyway.
	 */
	this.w_log.info('destroying');
	this.w_destroyed = true;
	this.w_child.kill('SIGKILL');
};
