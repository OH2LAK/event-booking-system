// Tiny RPC client used by all pages:
// rpc.run.withSuccessHandler(fn).withFailureHandler(fn).<serverMethod>(args...)
// maps every call to POST /api/rpc/<serverMethod>.
(function () {
  function makeRunner(ok, fail) {
    return new Proxy({}, {
      get: function (_, method) {
        if (method === 'withSuccessHandler') return function (fn) { return makeRunner(fn, fail); };
        if (method === 'withFailureHandler') return function (fn) { return makeRunner(ok, fn); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          fetch('/api/rpc/' + encodeURIComponent(method), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ args: args }),
          })
            .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
            .then(function (x) {
              if (!x.r.ok || x.j.error) {
                var err = { message: x.j.error || ('HTTP ' + x.r.status) };
                if (fail) fail(err); else console.error('RPC failed:', method, err.message);
              } else if (ok) {
                ok(x.j.result);
              }
            })
            .catch(function (e) { if (fail) fail(e); else console.error('RPC failed:', method, e); });
        };
      },
    });
  }
  window.rpc = { run: makeRunner(null, null) };
})();
