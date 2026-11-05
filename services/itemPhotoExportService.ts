import { Linking, Platform, Share } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
export async function saveItemPhoto(uri: string): Promise<void> {
  if (!uri) throw new Error('Select a photo first.');
  if (Platform.OS === 'web') { await Linking.openURL(uri); return; }
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Allow Photos access in your device settings to save this image.');
  let temporary: string | null = null;
  try {
    if (/^https?:\/\//.test(uri)) {
      if (!FileSystem.cacheDirectory) throw new Error('Photo download storage is unavailable on this device.');
      const result = await FileSystem.downloadAsync(uri, `${FileSystem.cacheDirectory}swish_photo_${Date.now()}.jpg`);
      if (result.status !== 200) throw new Error('The photo could not be downloaded.');
      temporary = result.uri;
    }
    await MediaLibrary.saveToLibraryAsync(temporary ?? uri);
  } finally { if (temporary) await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => undefined); }
}
export async function shareItemPhoto(uri: string): Promise<void> {
  if (!uri) throw new Error('Select a photo first.');
  await Share.share({ url: uri, message: uri });
}
