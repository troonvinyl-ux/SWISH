// Production PostgREST builders expose abortSignal(signal). Lightweight test
// doubles intentionally model only query chaining, so add the same no-op link
// in the Node test environment without changing production query behavior.
if (!Object.prototype.abortSignal) {
  Object.defineProperty(Object.prototype, 'abortSignal', {
    configurable: true,
    writable: true,
    value: function abortSignal() {
      return this;
    },
  });
}
