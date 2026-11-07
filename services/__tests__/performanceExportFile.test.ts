jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-file-system', () => ({ cacheDirectory: 'file:///cache/', EncodingType: { UTF8: 'utf8' }, writeAsStringAsync: jest.fn().mockResolvedValue(undefined), deleteAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(true), shareAsync: jest.fn().mockResolvedValue(undefined) }));
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { deliverPerformanceJson } from '@/services/performanceExportFileService';
import type { PerformanceExport } from '@/services/performanceExportService';
const report = { generatedAt: '2026-11-07T12:00:00.000Z', schemaVersion: 'swish-performance-export-v1' } as PerformanceExport;
beforeEach(() => { jest.clearAllMocks(); (Platform as any).OS = 'ios'; });
test('native export shares an application/json file and cleans its temporary bytes', async () => {
 const authorize = jest.fn().mockResolvedValue(undefined);
 expect(await deliverPerformanceJson(report, authorize)).toBe('share_opened');
 expect(authorize).toHaveBeenCalledTimes(2);
 expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(expect.stringMatching(/\.json$/), expect.stringContaining('schemaVersion'), { encoding: 'utf8' });
 expect(Sharing.shareAsync).toHaveBeenCalledWith(expect.stringMatching(/\.json$/), expect.objectContaining({ mimeType: 'application/json', UTI: 'public.json' }));
 expect(FileSystem.deleteAsync).toHaveBeenCalledWith(expect.stringMatching(/\.json$/), { idempotent: true });
});
test('revoked permission after disk write cleans up without opening the share sheet', async () => {
 const authorize = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
 await expect(deliverPerformanceJson(report, authorize)).rejects.toThrow('denied');
 expect(Sharing.shareAsync).not.toHaveBeenCalled(); expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
});
test('share sheet failure still cleans up and does not falsely confirm a save', async () => {
 (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
 await expect(deliverPerformanceJson(report, jest.fn().mockResolvedValue(undefined))).rejects.toThrow('unavailable');
 expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
});
test('web click downloads JSON with temporary URL cleanup and no native calls', async () => {
 (Platform as any).OS = 'web'; jest.useFakeTimers();
 const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
 const oldCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL'), oldRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
 const click = jest.fn(), remove = jest.fn(), appendChild = jest.fn();
 const anchor: any = { style: {}, click, remove };
 Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => anchor, body: { appendChild } } });
 const create = jest.fn().mockReturnValue('blob:temporary'), revoke = jest.fn();
 Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
 Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
 try {
  const authorize = jest.fn().mockResolvedValue(undefined);
  expect(await deliverPerformanceJson(report, authorize)).toBe('download_started');
  expect(authorize).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1);
  expect(anchor.download).toMatch(/^swish-performance-.*\.json$/); expect(create.mock.calls[0][0].type).toBe('application/json');
  expect(remove).toHaveBeenCalledTimes(1); expect(Sharing.shareAsync).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1000); expect(revoke).toHaveBeenCalledWith('blob:temporary');
 } finally {
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete (globalThis as any).document;
  if (oldCreate) Object.defineProperty(URL, 'createObjectURL', oldCreate); else delete (URL as any).createObjectURL;
  if (oldRevoke) Object.defineProperty(URL, 'revokeObjectURL', oldRevoke); else delete (URL as any).revokeObjectURL;
  jest.useRealTimers();
 }
});
