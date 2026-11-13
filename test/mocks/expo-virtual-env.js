// Expo exposes this ESM helper internally. Node/Jest needs the same minimal
// environment surface without loading Expo's untransformed virtual module.
module.exports = { env: process.env };
