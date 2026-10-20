const { getDefaultConfig } = require('expo/metro-config');
require('./scripts/staging-metadata.cjs')();
module.exports = getDefaultConfig(__dirname);
