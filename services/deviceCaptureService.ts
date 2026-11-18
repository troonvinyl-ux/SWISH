// Native system camera fallback, independent of the embedded Expo viewfinder.
import * as ImagePicker from 'expo-image-picker';

export async function captureWithDeviceCamera() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { photo: null, error: 'Allow camera access in app settings, or choose a photo from your library.' };

  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false, base64: false, exif: false });
  if (result.canceled) return { photo: null, error: null };

  const photo = result.assets?.[0];
  if (!photo?.uri) return { photo: null, error: 'The device camera returned no photo. Try the photo library.' };
  return { photo: { uri: photo.uri, width: photo.width, height: photo.height }, error: null };
}
