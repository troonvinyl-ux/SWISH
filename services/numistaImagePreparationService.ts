import * as ImageManipulator from 'expo-image-manipulator';
import { identificationResize } from '@/shared/identificationPolicy';
import { selectNumistaFaces, NUMISTA_IMAGE_LIMITS, validateNumistaImages, type CoinPhotoSource, type NumistaImage } from '@/shared/numistaImageSearch';
// Make two non-generative JPEG copies, including stored HTTPS originals. Never use enhanced/studio URIs.
export async function prepareNumistaImages(photos: CoinPhotoSource[]): Promise<NumistaImage[]> {
  const output: NumistaImage[] = [];
  for (const photo of selectNumistaFaces(photos)) {
    const source = photo.uri.length > 256 && /^[A-Za-z0-9+/=\r\n]+$/.test(photo.uri) ? `data:image/jpeg;base64,${photo.uri.replace(/\s/g, '')}` : photo.uri;
    const resize = identificationResize(photo.width, photo.height, 1024);
    let copy = await ImageManipulator.manipulateAsync(source, resize ? [{ resize }] : [], { format: ImageManipulator.SaveFormat.JPEG, compress: 0.75, base64: true });
    if (Math.max(copy.width, copy.height) > 1024 || (copy.base64?.length ?? 0) > NUMISTA_IMAGE_LIMITS.imageCharacters) {
      const maximum = (copy.base64?.length ?? 0) > NUMISTA_IMAGE_LIMITS.imageCharacters ? 768 : 1024;
      const bounded = identificationResize(copy.width, copy.height, maximum);
      copy = await ImageManipulator.manipulateAsync(copy.uri, bounded ? [{ resize: bounded }] : [], { format: ImageManipulator.SaveFormat.JPEG, compress: 0.65, base64: true });
    }
    output.push({ mime_type: 'image/jpeg', image_data: copy.base64?.replace(/^data:image\/[^;]+;base64,/i, '') ?? '', width: copy.width, height: copy.height, label: (photo.slotLabel ?? photo.slotId ?? `Coin face ${output.length + 1}`).slice(0, 120) });
  }
  const error = validateNumistaImages(output);
  if (error) throw new Error(error);
  return output;
}
