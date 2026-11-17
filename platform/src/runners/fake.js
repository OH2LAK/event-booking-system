'use strict';
// Records calls instead of running Docker. Used by tests and RUNNER=fake dry runs.
const calls = [];
const rec = (op, ...args) => { calls.push({ op, args }); };
module.exports = {
  calls,
  async pull() { rec('pull'); },
  async initEvent(name, env, json) { rec('initEvent', name, env, json); return '{"success":true}'; },
  async start(name, env, labels) { rec('start', name, env, labels); },
  async stop(name) { rec('stop', name); },
  async resume(name) { rec('resume', name); },
  async remove(name) { rec('remove', name); }
};
