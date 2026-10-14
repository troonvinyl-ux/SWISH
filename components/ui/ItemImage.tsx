// ItemImage — drop-in replacement for expo-image when displaying eBay/external URLs.
// Passes the required HTTP headers so eBay CDN accepts the request without a browser Referer.
// Also handles null/empty gracefully with a niche-aware placeholder icon.

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Image, ImageStyle } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius } from '@/constants/theme';

// eBay CDN requires these headers to serve images to non-browser clients
const EBAY_HEADERS = {
  Referer: 'https://www.ebay.co.uk/',
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

function isEbayUrl(uri: string | null | undefined): boolean {
  return !!uri && (uri.includes('ebayimg.com') || uri.includes('ebay.com/images'));
}

/**
 * Return a niche-appropriate default icon for the placeholder.
 * This prevents the coin icon ("toll") from appearing in MX, bike,
 * and clothing inventory cards when no image is available.
 */
export function getNichePlaceholderIcon(specialistId?: string | null): string {
  if (!specialistId) return 'inventory-2';
  const id = specialistId.toLowerCase();
  if (id === 'motocross') return 'two-wheeler';
  if (id === 'bicycles' || id === 'cycling') return 'pedal-bike';
  if (id === 'clothing' || id === 'trainers_sneakers') return 'checkroom';
  if (id === 'coins' || id === 'coins_uk' || id === 'islamic_silver' ||
      id === 'gold' || id === 'silver' || id === 'banknotes' || id === 'ancient_artefacts') return 'toll';
  return 'inventory-2';
}

interface ItemImageProps {
  uri?: string | null;
  style?: ImageStyle | any;
  contentFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  transition?: number;
  /** Override placeholder icon. If omitted, use specialistId to derive the correct niche icon. */
  placeholderIcon?: string;
  /** The item's specialist_id — used to derive a niche-appropriate placeholder icon. */
  specialistId?: string | null;
  placeholderIconSize?: number;
  placeholderStyle?: any;
}

export function ItemImage({
  uri,
  style,
  contentFit = 'cover',
  transition = 200,
  placeholderIcon,
  specialistId,
  placeholderIconSize = 22,
  placeholderStyle,
}: ItemImageProps) {
  if (!uri) {
    // Derive the correct placeholder icon: explicit override > niche-derived > default
    const icon = placeholderIcon ?? getNichePlaceholderIcon(specialistId) ?? 'inventory-2';
    return (
      <View style={[styles.placeholder, placeholderStyle ?? style]}>
        <MaterialIcons name={icon as any} size={placeholderIconSize} color={Colors.textTertiary} />
      </View>
    );
  }

  return (
    <Image
      source={
        isEbayUrl(uri)
          ? { uri, headers: EBAY_HEADERS }
          : { uri }
      }
      style={style}
      contentFit={contentFit}
      transition={transition}
      recyclingKey={uri}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: Colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
});
