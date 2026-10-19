// app.config.js — SWISH dynamic Expo configuration.
//
// Metro duplicate-package handling is configured in metro.config.js. Do not
// delete .pnpm stubs here: Metro resolves through those package links.
//
// When SWISH_NICHE is set by a branded EAS profile, give that build its own
// app identity and embed the fixed product ID for runtime routing. If unset,
// preserve the existing OnSpace/legacy configuration unchanged.

const NICHE_BUILDS = {
  coins: {
    id: "coins",
    name: "Coin Flipper",
    slug: "swish-coin-flipper",
    scheme: "coinflipper",
    androidPackage: "com.swish.coinflipper",
    iosBundleIdentifier: "com.swish.coinflipper",
  },
  motocross: {
    id: "motocross",
    name: "Flipper MX",
    slug: "swish-flipper-mx",
    scheme: "flippermx",
    androidPackage: "com.swish.flippermx",
    iosBundleIdentifier: "com.swish.flippermx",
  },
  bicycles: {
    id: "bicycles",
    name: "Bike Flipper",
    slug: "swish-bike-flipper",
    scheme: "bikeflipper",
    androidPackage: "com.swish.bikeflipper",
    iosBundleIdentifier: "com.swish.bikeflipper",
  },
  surplus_flip: {
    id: "surplus_flip",
    name: "Surplus Flip",
    slug: "swish-surplus-flip",
    scheme: "surplusflip",
    androidPackage: "com.swish.surplusflip",
    iosBundleIdentifier: "com.swish.surplusflip",
  },
  clothing: {
    id: "clothing",
    name: "Threads Flip",
    slug: "swish-threads-flip",
    scheme: "threadsflip",
    androidPackage: "com.swish.threadsflip",
    iosBundleIdentifier: "com.swish.threadsflip",
  },
};

module.exports = ({ config }) => {
  const selected = process.env.SWISH_NICHE;
  // Preserve the existing app identity for OnSpace/legacy workflows unless
  // an explicit branded build profile requests one of the four products.
  if (!selected) return config;

  const niche = NICHE_BUILDS[selected];
  if (!niche) {
    throw new Error(
      `Unsupported SWISH_NICHE "${selected}". Choose coins, motocross, bicycles, clothing, or surplus_flip.`,
    );
  }

  return {
    ...config,
    name: niche.name,
    slug: niche.slug,
    scheme: niche.scheme,
    ios: {
      ...config.ios,
      bundleIdentifier: niche.iosBundleIdentifier,
    },
    android: {
      ...config.android,
      package: niche.androidPackage,
    },
    extra: {
      ...config.extra,
      swishNicheId: niche.id,
      swishAppScheme: niche.scheme,
    },
  };
};
