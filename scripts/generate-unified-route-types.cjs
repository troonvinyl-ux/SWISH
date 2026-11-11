// Regenerate Expo Router's declarations from the complete canonical app tree before tsc.
const fs = require('node:fs');
const path = require('node:path');
const context = require('expo-router/build/testing-library/require-context-ponyfill').default;
const { getTypedRoutesDeclarationFile } = require('expo-router/build/typed-routes/generate');
const { EXPO_ROUTER_CTX_IGNORE } = require('expo-router/_ctx-shared');
const root = path.resolve('app');
const declaration = getTypedRoutesDeclarationFile(context(root, true, EXPO_ROUTER_CTX_IGNORE));
if (!declaration) throw Error('Canonical route type generation failed');
fs.mkdirSync('.expo/types', { recursive: true });
fs.writeFileSync('.expo/types/router.d.ts', declaration);
console.log('Canonical Expo Router declarations regenerated.');
