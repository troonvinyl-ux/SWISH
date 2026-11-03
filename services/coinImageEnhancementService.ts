// Backwards-compatible exports for existing Coin Flipper callers.
export { generateSharedObjectImageReference as generateCoinImageReference } from './sharedImagePreparationService';
export type { PreparedObjectImageReference as CoinImageReference } from './sharedImagePreparationService';
