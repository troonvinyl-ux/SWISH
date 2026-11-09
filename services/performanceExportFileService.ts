import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { PerformanceExport } from './performanceExportService';
export type PerformanceFileResult = 'download_started' | 'share_opened';
/** No server upload or persistent export cache. Native scratch files are removed on every exit path. */
export async function deliverPerformanceJson(report: PerformanceExport, authorize: () => Promise<void>): Promise<PerformanceFileResult> {
 const json = JSON.stringify(report, null, 2);
 if (json.length > 200000) throw new Error('Performance export exceeded its metadata-only file limit.');
 const filename = `swish-performance-${new Date(report.generatedAt).toISOString().replace(/[:.]/g, '-')}.json`;
 if (Platform.OS === 'web') {
  await authorize();
  // Browser APIs are used only on a user-triggered operation, never during SSR/module initialization.
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') throw new Error('JSON download is unavailable in this preview.');
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  try {
   link.href = url; link.download = filename; link.style.display = 'none';
   document.body.appendChild(link); link.click();
  } finally {
   link.remove();
   // Let the browser consume the download before revoking its temporary URL.
   setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return 'download_started';
 }
 if (!FileSystem.cacheDirectory || !await Sharing.isAvailableAsync()) throw new Error('JSON file sharing is unavailable on this device.');
 await authorize();
 const uri = `${FileSystem.cacheDirectory}${filename}`;
 try {
  await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 });
  await authorize();
  await Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Export SWISH performance diagnostics' });
  return 'share_opened';
 } finally { await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined); }
}
