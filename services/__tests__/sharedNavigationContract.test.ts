import fs from 'node:fs';
import path from 'node:path';

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

describe('shared five-area niche navigation contract', () => {
  const layout = source('app/(tabs)/_layout.tsx');

  test('all niche apps expose Home, Scan, Inventory, Listings and More', () => {
    expect(layout).toContain('<TabLabel label="Home"');
    expect(layout).toContain('<TabLabel label="Inventory"');
    expect(layout).toContain('<TabLabel label="Listings"');
    expect(layout).toContain('<TabLabel label="More"');

    const listingsTab = layout.split('<Tabs.Screen\n        name="listings"')[1]?.split('/>')[0] ?? '';
    const moreTab = layout.split('<Tabs.Screen name="account"')[1]?.split('/>')[0] ?? '';
    expect(listingsTab).not.toContain('href: null');
    expect(moreTab).not.toContain('href: null');
  });

  test('niche home and scanner retain their own brand accent', () => {
    expect(layout).toContain('NICHES[resolvedNicheId]?.color');
    expect(layout).toContain("nicheHome.isAntiques\n    ? '#D8AD52'");
    expect(layout).toContain('backgroundColor: nicheAccent');
  });

  test('More keeps the dedicated Antique Flipper destination and branded settings for niche apps', () => {
    const account = source('app/(tabs)/account.tsx');
    expect(account).toContain('effectiveNicheId === \'antiques\'');
    expect(account).toContain('/(tabs)/antique-more');
    expect(account).toContain('return <SettingsScreen embedded />');
  });

  test('subscriber More screens cannot switch niches; master workspace retains the switcher', () => {
    const settings = source('app/settings.tsx');
    expect(settings).toContain('{!embedded ? (');
    expect(settings).toContain('if (!isLifetime || embedded) return null;');
  });

  test('Listings tab resolves the build-time niche before persisted active niche', () => {
    const listings = source('app/(tabs)/listings.tsx');
    expect(listings).toContain('fixedNicheId ?? activeNicheId');
  });
});
