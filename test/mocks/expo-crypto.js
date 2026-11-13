const { createHash, randomUUID } = require('node:crypto');

// Node-only stand-in for the small Expo Crypto surface used by service tests.
// Individual suites may still provide stricter jest.mock factories.
module.exports = {
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm, value) => createHash('sha256').update(String(value)).digest('hex'),
  randomUUID,
};
