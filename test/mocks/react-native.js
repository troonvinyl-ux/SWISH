// Native primitives are not loaded by the Node-only regression configuration.
// Keep this deliberately small: UI tests supply their own richer factory.
module.exports = {
  Platform: { OS: 'web', select: values => values.web ?? values.default },
  Linking: { openURL: async () => undefined, canOpenURL: async () => false },
  Share: { share: async () => ({}), sharedAction: 'sharedAction', dismissedAction: 'dismissedAction' },
};
