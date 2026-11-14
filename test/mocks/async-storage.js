// Minimal in-memory AsyncStorage implementation for the Node/Jest runtime.
// Production bundles resolve the native module, not this mapper entry.
const values = new Map();

const storage = {
  async getItem(key) {
    return values.get(key) ?? null;
  },
  async setItem(key, value) {
    values.set(key, String(value));
  },
  async removeItem(key) {
    values.delete(key);
  },
  async clear() {
    values.clear();
  },
};

module.exports = storage;
module.exports.default = storage;
