// SWISH — retain Expo's canonical Metro configuration.
// Installed dependency-tree checks happen before bundling: resolver blockLists
// cannot repair duplicate installed packages and must not hide Metro sources.
'use strict';

const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
