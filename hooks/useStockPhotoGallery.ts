import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, type FlatList } from 'react-native';
import { saveItemPhoto, shareItemPhoto } from '@/services/itemPhotoExportService';

export function useStockPhotoGallery(media: string[]) {
  const [width, setWidth] = useState(343);
  const [selectedUrl, setSelectedUrl] = useState(media[0] ?? '');
  const [fullscreen, setFullscreen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [viewport, setViewport] = useState({ width: 375, height: 667 });
  const list = useRef<FlatList<string>>(null);
  const thumbnails = useRef<FlatList<string>>(null);
  const mediaKey = JSON.stringify(media);
  const index = Math.max(0, media.indexOf(selectedUrl));
  const activeUrl = media[index] ?? '';
  useEffect(() => {
    const update = () => { const next = Dimensions.get('window'); setViewport({ width: Math.max(1, next.width || 375), height: Math.max(1, next.height || 667) }); };
    update(); const subscription = Dimensions.addEventListener('change', update);
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    setSelectedUrl(media.includes(selectedUrl) ? selectedUrl : media[0] ?? '');
    setZoomed(false);
    const timer = setTimeout(() => { list.current?.scrollToOffset({ offset: index * width, animated: false }); }, 0);
    return () => clearTimeout(timer);
  }, [mediaKey, width]);
  const select = useCallback((next: number) => {
    const bounded = Math.min(Math.max(0, next), Math.max(0, media.length - 1));
    setSelectedUrl(media[bounded] ?? ''); setZoomed(false);
    list.current?.scrollToOffset({ offset: bounded * width, animated: true });
    thumbnails.current?.scrollToOffset({ offset: Math.max(0, bounded * 88 - width / 2 + 44), animated: true });
  }, [mediaKey, width]);
  const onScroll = useCallback((offset: number) => {
    const next = Math.min(Math.max(0, Math.round(offset / Math.max(1, width))), Math.max(0, media.length - 1));
    setSelectedUrl(media[next] ?? '');
  }, [mediaKey, width]);
  const height = useMemo(() => Math.min(420, Math.max(240, width * 0.9)), [width]);
  const exportPhoto = useCallback(async (action: 'save' | 'share', imageUri = activeUrl) => {
    if (exporting || !imageUri) return;
    setExporting(true); setExportError(null);
    try { if (action === 'save') await saveItemPhoto(imageUri); else await shareItemPhoto(imageUri); }
    catch (cause) { if (mounted.current) setExportError(cause instanceof Error ? cause.message : 'The photo could not be exported.'); }
    finally { if (mounted.current) setExporting(false); }
  }, [exporting, activeUrl]);
  const closeFullscreen = useCallback(() => { setFullscreen(false); setZoomed(false); setExportError(null); }, []);
  return { width, height, setWidth, index, activeUrl, select, onScroll, list, thumbnails, fullscreen, setFullscreen, closeFullscreen, zoomed, setZoomed, viewport, exporting, exportError, exportPhoto };
}
