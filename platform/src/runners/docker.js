'use strict';
// Runs tenant containers through the Docker CLI. Uses execFile (no shell), so slugs/values can't inject commands.
const { execFile } = require('child_process');
const config = require('../config');

function docker(args, input) {
  return new Promise((resolve, reject) => {
    const p = execFile('docker', args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { err.message = `docker ${args[0]} failed: ${(stderr || err.message).trim().slice(0, 500)}`; return reject(err); }
      resolve(stdout.trim());
    });
    if (input !== undefined) { p.stdin.end(input); }
  });
}
const envArgs = env => Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const hardening = ['--security-opt', 'no-new-privileges', '--cap-drop', 'ALL', '--read-only', '--tmpfs', '/tmp'];

module.exports = {
  async pull() { await docker(['pull', config.image]); },
  // One-shot container: applies the schema and stores the event details before the app starts.
  async initEvent(name, env, eventJson) {
    return docker(['run', '--rm', '-i', '--name', `${name}-init`, '--network', config.dockerNetwork, ...hardening,
      ...envArgs(env), config.image, 'node', 'src/tools/init-event.js'], eventJson);
  },
  async start(name, env, labels) {
    const l = Object.entries(labels).flatMap(([k, v]) => ['--label', `${k}=${v}`]);
    await docker(['run', '-d', '--name', name, '--network', config.dockerNetwork, '--restart', 'unless-stopped',
      '--memory', config.tenantLimits.memory, '--cpus', config.tenantLimits.cpus, '--pids-limit', String(config.tenantLimits.pids),
      ...hardening, ...envArgs(env), ...l, config.image]);
  },
  async stop(name) { await docker(['stop', name]); },
  async resume(name) { await docker(['start', name]); },
  async remove(name) { try { await docker(['rm', '-f', name]); } catch (e) { if (!/No such container/i.test(e.message)) throw e; } }
};
