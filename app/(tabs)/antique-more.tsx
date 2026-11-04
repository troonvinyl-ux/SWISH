import SettingsScreen from '../settings';

/**
 * Antiques Flipper's More tab.
 *
 * The previous route imported a ModuleMore component that is not present in
 * the repository, which caused the route to fail at module resolution and
 * display a blank screen. Reuse the existing settings screen and its live
 * account/eBay/data-sync actions instead of introducing a second settings
 * implementation or a placeholder screen.
 */
export default function AntiqueMoreScreen() {
  return <SettingsScreen embedded />;
}
