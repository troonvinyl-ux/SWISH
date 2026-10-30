import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import * as XLSX from 'xlsx';
import { normaliseManifest, parseManifestText, type ParsedManifest } from './manifestParser';
export async function pickManifest(onProgress?: (phase: 'reading' | 'checking') => void): Promise<{ name: string; manifest: ParsedManifest } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['text/csv','text/plain','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel'], copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  onProgress?.('reading');
  if ((asset.size ?? 0) > 5000000) throw new Error('Maximum file size 5 MB. Split this manifest.');
  let matrix: unknown[][];
  if (/\.xlsx?$/i.test(asset.name)) {
    const workbook = Platform.OS === 'web'
      ? XLSX.read(await (await fetch(asset.uri)).arrayBuffer(), { type: 'array' })
      : XLSX.read(await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }), { type: 'base64' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][];
  } else {
    const text = Platform.OS === 'web' ? await (await fetch(asset.uri)).text() : await FileSystem.readAsStringAsync(asset.uri);
    matrix = parseManifestText(text);
  }
  onProgress?.('checking');
  return { name: asset.name, manifest: normaliseManifest(matrix) };
}
