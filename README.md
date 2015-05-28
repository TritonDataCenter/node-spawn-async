# spawn-async: spawn child processes asynchronously

## Synopsis

    var mod_spawnasync = require('spawn-async');
    var worker = mod_spawnasync.createWorker({ 'log': log });

    /* ... */

    /*
     * "aspawn" is a simpler version of Node's execFile interface, closer to
     * execve(2) in the way arguments are specified, but buffering stdout and
     * stderr like Node's "exec" and "execFile".  The main difference is that
     * the child is forked from a child process, avoiding blocking the main loop
     * or duplicating the heap (even virtually).
     */
    worker.aspawn(['ls', '-l', '/etc/passwd'],
        function (err, stdout, stderr) {
            if (err) {
                console.log('error: %s', err.message);
                console.error(stderr);
            } else {
                console.log(stdout);
                worker.destroy();
            }
        });


## Why?

While Node's `child_process` module makes it convenient to execute shell
commands from Node programs, doing so even occasionally in an otherwise busy
server process can result in significant latency bubbles.  Besides that, forking
a Node server with a large heap just to exec some other program causes a
significant amount of additional swap to be used, which is problematic in
low-memory environments.  This module provides an interface for spawning new
processes using a worker process to do the actual fork/exec.  This worker
process itself is spawned when create a Worker object, and you should do this
only once when you initialize the server.

**Details**: Node implements spawn() and related functions synchronously in the
main thread, waiting not only for the fork(2) to complete (which itself can take
many milliseconds, and requires waiting for all other threads to stop), but also
for the child process to exit(3c) or exec(2).  While workloads that make
excessive use of fork(2) are hardly high-performance to begin with, the behavior
of blocking the main thread for hundreds of milliseconds each time is
unnecessarily pathological for otherwise reasonable workloads.


## API

The basic object is the `Worker`, created with `createWorker(options)`.  The
only supported option is "log", which is required and should be a
node-bunyan-style logger.  The resulting object is an EventEmitter with the
following methods:

`aspawn(argv, [options], callback)`: invokes the program identified by argv,
waits for it to exit, buffers stdout and stderr, and invokes `callback(err,
stdout, stderr)` (just like Node's execFile).  aspawn does not support pipelines
or other shell syntax; for that, just invoke `bash -c "..."` instead.

`argv` is an array of arguments *including* the program name itself; this is
different than Node's child\_process module but is consistent with the exec
family of POSIX functions and how shells work.

`options` may be an object with the following property:

* `env`: program environment (see exec(2); default: current environment)

The stdout and stderr encoding is always `'utf8'`.

`destroy()`: forcefully kills the worker process and causes pending `aspawn`
commands to fail.  The behavior with respect to the child processes that you've
already launched is undefined, so you should only call this when you know there
are no outstanding commands, when you don't care about leaving orphaned child
processes around, or your system will automatically clean up such child
processes.

The worker process sticks around (leaving your Node program running) until you
call `destroy()`.

### Events

Workers may emit the following events:

`exit (err)`: the worker process has exited.  You can usually ignore this event.
This event fires when the worker exits normally as a result of a call to
`destroy()` (in which case `err` is null), as well as when the worker exits
abnormally (in which case it will be restarted automatically).

`error (err)`: fatal error on this Worker.  This is not fatal to the Node
program, but indicates that the worker will be unable to process any subsequent
commands.  The only normal circumstances when this should happen is if the
worker process exits abnormally and cannot be restarted.


### What about everything else?

Node's `child_process` module supports several other functions and options not
supported here.  They fall into a few categories.

Commands using shell syntax (i.e., `exec`, as opposed to `execFile`) can be
executed by just executing `bash -c "..."` with `aspawn`.

The `cwd`, `timeout`, `maxBuffer`, `killSignal`, and `stdio` options, along with
an interface for streaming stdout and stderr (i.e. `spawn` instead of
`execFile`) could in principle be supported, but usage of these features
suggests something less simple than just executing a small, independent shell
command.  The robustness and performance implications of doing that from a
high-volume server should be considered very carefully.


## Implementation notes

The implementation restarts the worker process immediately if it ever exits
abnormally.  There's no reason this should happen under normal operation, but
it can happen if the process crashes or an operator kills it, and it has the
same latency and memory impact described above.  If this becomes problematic, it
would be possible to avoid automatically restarting the worker and instead give
the caller control over when it gets restarted.  Since such a change could be
made backwards-compatibly and it seems unlikely anyone would ever use this
feature, it's not yet implemented.

The child process itself is currently implemented as a Node process for rapid
development, but it could easily be made a C program to reduce the memory
overhead.
