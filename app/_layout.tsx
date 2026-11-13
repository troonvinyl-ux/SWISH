// SWISH root layout
import { Stack, useRouter, usePathname } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AlertProvider, AuthProvider } from '@/template';
import { AppProvider } from '@/contexts/AppContext';
import { TunesProvider } from '@/contexts/TunesContext';
import { ManifestOpportunityProvider } from '@/contexts/ManifestOpportunityContext';
import { WatchedLotsProvider } from '@/contexts/WatchedLotsContext';
import { QuickListProvider } from '@/contexts/QuickListContext';
import { EbayMessagesProvider } from '@/contexts/EbayMessagesContext';
import { markQuickListAppOpened } from '@/services/quickListTelemetryService';
import { setAppVisible } from '@/services/appVisibilityService';
import { AppState, View, StyleSheet } from 'react-native';
import { SellerOrdersProvider } from '@/contexts/SellerOrdersContext';
import { AppUpdatesProvider } from '@/contexts/AppUpdatesContext';
import { AppUpdateNotice } from '@/components/feature/AppUpdateNotice';
import { Colors } from '@/constants/theme';
import { NicheRouteBoundary } from '@/components/layout/NicheRouteBoundary';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useCallback } from 'react';
import { Platform, BackHandler } from 'react-native';
import { IS_TV } from '@/hooks/useTVNavigation';
import { useFonts } from 'expo-font';
import {
  MaterialIcons,
  MaterialCommunityIcons,
  FontAwesome,
} from '@expo/vector-icons';

SplashScreen.preventAutoHideAsync().catch(() => {
  // The host may already have configured the splash screen during launch.
});

// ── TV BackHandler ────────────────────────────────────────────────────────────
// Intercepts the Fire Stick hardware Back button.
// - On any non-root screen: go back normally (let Expo Router handle it).
// - On the root tab screen: let the system handle it (exits to Fire OS home),
//   which is the expected behaviour for TV apps and avoids an exit dialog.
function TVBackHandlerProvider({ children }: { children: React.ReactNode }) {
  if (!IS_TV) return <>{children}</>;

  // We use a stateless effect component so we don't import useRouter at module
  // level when running on phones (keeps the bundle tree-shaken on mobile).
  return <TVBackHandlerEffect>{children}</TVBackHandlerEffect>;
}

function TVBackHandlerEffect({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!IS_TV) return;

    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      // If we can go back in the navigation stack, do so
      if (router.canGoBack()) {
        router.back();
        return true; // consumed — do not propagate to system
      }
      // On the root screen, return false → system handles it (goes to Fire OS home)
      return false;
    });

    return () => handler.remove();
  }, [router, pathname]);

  return <>{children}</>;
}

export default function RootLayout() {
  // Start loading icon fonts, but never make the entire app depend on the font
  // loader completing. Some preview/runtime environments can stall font loading;
  // returning null here leaves the user with a blank launch screen indefinitely.
  useFonts({
    ...MaterialIcons.font,
    ...MaterialCommunityIcons.font,
    ...FontAwesome.font,
  });

  // Hide the native splash as soon as the root layout mounts. The app shell can
  // render while icon fonts finish loading; missing glyphs are preferable to a
  // failed/blank app launch.
  useEffect(() => {
    const browserVisible=()=>Platform.OS!=='web'||typeof document==='undefined'||!document.hidden;
    const updateVisible=()=>setAppVisible(browserVisible()&&AppState.currentState!=='background'&&AppState.currentState!=='inactive');
    updateVisible();
    const foreground=AppState.addEventListener('change',state=>{setAppVisible(state==='active'&&browserVisible());if(state==='active')markQuickListAppOpened();});
    if(Platform.OS==='web'&&typeof document!=='undefined')document.addEventListener('visibilitychange',updateVisible);
    SplashScreen.hideAsync().catch(() => {
      // The splash screen may already have been hidden by the host runtime.
    });
    return()=>{foreground.remove();if(Platform.OS==='web'&&typeof document!=='undefined')document.removeEventListener('visibilitychange',updateVisible);};
  }, []);

  return (
    <AlertProvider>
      <SafeAreaProvider>
        <AuthProvider>
          <AppProvider>
            <TunesProvider>
            <ManifestOpportunityProvider>
            <WatchedLotsProvider>
            <QuickListProvider>
            <EbayMessagesProvider>
            <SellerOrdersProvider><AppUpdatesProvider>
            <TVBackHandlerProvider>
              <View style={rootStyles.screen}>
              <AppUpdateNotice />
              <View style={rootStyles.screen}>
              <NicheRouteBoundary>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="swish" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="login" />
                <Stack.Screen name="onboarding" />
                <Stack.Screen name="lot-opportunity" />
                <Stack.Screen name="watched-lots" options={{ headerShown: true, title: 'Watched lots', headerStyle: { backgroundColor: Colors.surface }, headerTintColor: Colors.textPrimary, headerShadowVisible: false }} />
                <Stack.Screen name="inventory-tools" options={{ headerShown: true, title: 'More · Inventory tools', headerStyle: { backgroundColor: Colors.surface }, headerTintColor: Colors.textPrimary, headerShadowVisible: false }} />
                <Stack.Screen name="item/[id]" />
                <Stack.Screen name="acquisition/[id]" />
                <Stack.Screen name="opportunities" />
                <Stack.Screen name="money" />
                <Stack.Screen name="repricing" />
                <Stack.Screen name="orders" />
                <Stack.Screen name="settings" />
                <Stack.Screen name="marketplaces" />
                <Stack.Screen name="audit" />
                <Stack.Screen name="privacy-policy" />
                <Stack.Screen name="listings" />
                <Stack.Screen name="ebay-import" />
                <Stack.Screen name="ebay-draft-sync-test" />
                <Stack.Screen name="ebay-admin" />
                <Stack.Screen name="master-admin" />
                <Stack.Screen name="master-diagnostics" />
                <Stack.Screen name="reiss-ebay-test" />
                <Stack.Screen name="production-control" />
                <Stack.Screen name="edge-function-logs" />
                <Stack.Screen name="dispatch" />
                <Stack.Screen name="tasks" />
                <Stack.Screen name="stock-listing/[id]" />
                <Stack.Screen name="ebay-hub" />
                <Stack.Screen name="ebay-messages" />
                <Stack.Screen name="ebay-cases" />
                <Stack.Screen name="ebay-returns" />
                <Stack.Screen name="ebay-finances" />
                <Stack.Screen name="ebay-analytics" />
                <Stack.Screen name="ebay-csv" />
                <Stack.Screen name="ebay-log" />
                <Stack.Screen name="ebay-account" />
                <Stack.Screen name="ebay-offers" />
                <Stack.Screen name="ebay-listing-editor" />
                <Stack.Screen name="command-centre" />
                <Stack.Screen name="islamic-batch" />
                <Stack.Screen name="create-listing" />
                <Stack.Screen name="capture" />
                <Stack.Screen name="antique-capture" />
                <Stack.Screen name="specialist-workspace" />
                <Stack.Screen name="review-required" />
                <Stack.Screen name="silver-batch" />
                <Stack.Screen name="listing-preflight" />
                <Stack.Screen name="ebay-category-admin" />
                <Stack.Screen name="niche-select" />
                <Stack.Screen name="mx-acquisition" />
                <Stack.Screen name="keen-on-coins" />
                <Stack.Screen name="coin-flipper" />
                <Stack.Screen name="flipper-mx" />
                <Stack.Screen name="bike-flipper" />
                <Stack.Screen name="threads-flip" />
                <Stack.Screen name="subscription" />
                {/* ── Niche entry routes — one per subscriber application ── */}
                <Stack.Screen name="entry/coins" />
                <Stack.Screen name="entry/motocross" />
                <Stack.Screen name="entry/bicycles" />
                <Stack.Screen name="entry/clothing" />
                <Stack.Screen name="entry/collectibles" />
                <Stack.Screen name="entry/tunes-flip" />
                <Stack.Screen name="music-search" options={{ headerShown:true,title:'Tunes Flip · Catalogue',headerStyle:{backgroundColor:Colors.surface},headerTintColor:Colors.textPrimary }} />
                <Stack.Screen name="music-collection" options={{ headerShown:true,title:'Tunes Flip · Collection',headerStyle:{backgroundColor:Colors.surface},headerTintColor:Colors.textPrimary }} />
                <Stack.Screen name="buy-decision" />
                <Stack.Screen name="research" />
                <Stack.Screen name="deep-id-lab" />
              </Stack>
              </NicheRouteBoundary>
              </View>
              </View>
            </TVBackHandlerProvider>
            </AppUpdatesProvider></SellerOrdersProvider>
            </EbayMessagesProvider>
            </QuickListProvider>
            </WatchedLotsProvider>
            </ManifestOpportunityProvider>
            </TunesProvider>
          </AppProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </AlertProvider>
  );
}
const rootStyles = StyleSheet.create({ screen: { flex: 1, backgroundColor: Colors.background } });
