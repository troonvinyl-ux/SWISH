import { useEffect, useState } from 'react';
import { Dimensions, Platform } from 'react-native';
import { Layout } from '@/constants/theme';

export function useResponsiveLayout() {
  const [size, setSize] = useState({ width: Layout.defaultWidth, height: Layout.defaultHeight });
  useEffect(() => {
    const update = () => {
      const next = Dimensions.get('window');
      setSize({
        width: Number.isFinite(next.width) && next.width > 0 ? Math.max(1, next.width) : Layout.defaultWidth,
        height: Number.isFinite(next.height) && next.height > 0 ? Math.max(1, next.height) : Layout.defaultHeight,
      });
    };
    update();
    const subscription = Dimensions.addEventListener('change', update);
    return () => subscription.remove();
  }, []);
  return { ...size, desktopBrowser: Platform.OS === 'web' && size.width >= Layout.desktop };
}
