// hooks/useTVNavigation.ts
// Fire Stick / Android TV D-pad navigation utilities.
// Provides focus state tracking and TV-specific behaviour flags.
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

/** True when running on an Android TV / Fire Stick device */
export const IS_TV = Platform.isTV;

/**
 * Returns a { focused, onFocus, onBlur } bag that can be spread onto
 * any Pressable / View to track D-pad focus state.
 *
 * Usage:
 *   const tv = useTVFocusItem();
 *   <Pressable {...tv.handlers} style={[base, tv.focused && focusedStyle]} />
 */
export function useTVFocusItem() {
  const [focused, setFocused] = useState(false);

  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur  = useCallback(() => setFocused(false), []);

  return {
    focused,
    handlers: { onFocus, onBlur } as const,
  };
}

/**
 * Minimal accessibility props for a TV-focusable interactive element.
 * Spread onto Pressable / TouchableOpacity alongside isTVSelectable.
 */
export function tvA11y(label: string) {
  return {
    accessible: true,
    accessibilityLabel: label,
    isTVSelectable: true,
  } as const;
}
