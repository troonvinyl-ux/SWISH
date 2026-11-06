// Mocked binary I/O only. No device, storage or inventory writes.
import { encode } from 'base64-arraybuffer';
import { readBinaryBlob } from '../binaryBlobService';
const bytes = new Uint8Array([255, 216, 255, 0, 12, 128, 255]);
const originalReader = globalThis.FileReader;
const useReader = (mode: 'success' | 'error' | 'invalid' | 'stall' = 'success') => {
  const abort = jest.fn();
  const read = jest.fn();
  class NativeReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    abort() { abort(); }
    readAsDataURL(blob: unknown) {
      read(blob);
      if (mode === 'stall') return;
      if (mode === 'error') { this.onerror?.(); return; }
      this.result = mode === 'invalid' ? 'unreadable' : `data:application/octet-stream;base64,${encode(bytes.buffer)}`;
      this.onload?.();
    }
  }
  globalThis.FileReader = NativeReader as unknown as typeof FileReader;
  return { read, abort };
};
afterEach(() => { globalThis.FileReader = originalReader; jest.useRealTimers(); });
test('uses a browser Blob arrayBuffer when available', async () => {
  const arrayBuffer = jest.fn().mockResolvedValue(bytes.buffer);
  expect(new Uint8Array(await readBinaryBlob({ arrayBuffer }))).toEqual(bytes);
  expect(arrayBuffer).toHaveBeenCalledTimes(1);
});
test('Android/iOS Blob without arrayBuffer is read losslessly with FileReader', async () => {
  const { read } = useReader(); const blob = { size: bytes.length, type: 'image/jpeg' };
  expect(new Uint8Array(await readBinaryBlob(blob))).toEqual(bytes);
  expect(read).toHaveBeenCalledWith(blob);
});
test('typed-array slices do not include surrounding bytes', async () => {
  expect(new Uint8Array(await readBinaryBlob(bytes.subarray(2, 5)))).toEqual(bytes.slice(2, 5));
});
test.each(['error', 'invalid'] as const)('%s never accepts unverifiable bytes', async mode => {
  useReader(mode); await expect(readBinaryBlob({})).rejects.toThrow('could not be verified');
});
test('stalled readers timeout and clean up rather than hanging capture save', async () => {
  jest.useFakeTimers(); const { abort } = useReader('stall');
  const pending = readBinaryBlob({}).catch(error => error);
  jest.advanceTimersByTime(15000);
  expect((await pending).message).toContain('could not be verified');
  expect(abort).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
test('missing binary reader produces retry guidance, not an undefined-method error', async () => {
  globalThis.FileReader = undefined as unknown as typeof FileReader;
  await expect(readBinaryBlob({})).rejects.toThrow('Update the app');
});
