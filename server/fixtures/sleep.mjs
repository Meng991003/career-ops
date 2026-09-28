// Fixture for server/run-tests.mjs: outlives any short timeout so runScript
// has to kill it, exercising the timeout/signal code path.
setTimeout(() => {}, 5000);
