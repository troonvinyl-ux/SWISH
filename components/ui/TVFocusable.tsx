// components/ui/TVFocusable.tsx
// Wrapper that adds visible D-pad / remote focus styling on Fire Stick / Android TV.
// On non-TV platforms it renders children unchanged (zero overhead).
import React, { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type PressableProps, type ViewStyle } from 'react-native';
import { Colors, Radius } from '@/constants/theme';

interface TVFocusableProps extends PressableProps {
  /** Additional style for the outer container */
  containerStyle?: ViewStyle;
  /** Override the focus ring colour — defaults to Colors.primary */
  focusColor?: string;
  /** Accessibility label (required for TV) */
  label: string;
  /** Set to true for the element that should receive focus first on screen mount */
  preferFocus?: boolean;
  children: React.ReactNode;
}

/**
 * TVFocusable wraps a Pressable and, on Fire Stick / Android TV, shows a
 * visible focus ring when selected by the D-pad.  On phone/tablet it is
 * transparent — no extra wrapping is visible to the user.
 */
export default function TVFocusable({
  children,
  containerStyle,
  focusColor = Colors.primary,
  label,
  preferFocus = false,
  style,
  ...rest
}: TVFocusableProps) {
  const [focused, setFocused] = useState(false);

  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur  = useCallback(() => setFocused(false), []);

  // On non-TV platforms, forward children untouched (no-op wrapper)
  if (!Platform.isTV) {
    return (
      <Pressable
        style={style}
        accessible
        accessibilityLabel={label}
        {...rest}
      >
        {children}
      </Pressable>
    );
  }

  // TV path — render focus ring when selected by D-pad
  return (
    <Pressable
      style={[containerStyle, focused && [
        tv.focusRing,
        { borderColor: focusColor, shadowColor: focusColor },
      ]]}
      onFocus={onFocus}
      onBlur={onBlur}
      hasTVPreferredFocus={preferFocus}
      accessible
      accessibilityLabel={label}
      isTVSelectable
      {...rest}
    >
      {children}
    </Pressable>
  );
}

const tv = StyleSheet.create({
  focusRing: {
    borderWidth: 2.5,
    borderRadius: Radius.md,
    // Glow effect visible on dark TV backgrounds
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 12,
  },
});
