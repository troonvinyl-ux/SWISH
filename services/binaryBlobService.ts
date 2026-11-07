// React Native Blob lacks arrayBuffer() on some Android/iOS runtimes.
// Read unchanged binary content; never inspect RN Blob's private data fields.
import { decode } from 'base64-arraybuffer';

export async function readBinaryBlob(value: unknown): Promise<ArrayBuffer> {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return copy.buffer;
  }
  const blob = value as { arrayBuffer?: () => Promise<ArrayBuffer> } | null;
  if (!blob) throw new Error('Downloaded photograph is empty. Retry the saved item.');
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  if (typeof FileReader === 'undefined') throw new Error('This runtime cannot verify downloaded photographs. Update the app and retry the saved item.');
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => { clearTimeout(timer); reader.onload = null; reader.onerror = null; reader.onabort = null; };
    const fail = () => { cleanup(); reject(new Error('Downloaded photograph could not be verified. Retry the saved item; no duplicate is needed.')); };
    const timer = setTimeout(() => { fail(); try { reader.abort(); } catch { /* Already complete. */ } }, 15000);
    reader.onerror = fail;
    reader.onabort = fail;
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const match = result.match(/^data:[^,]*;base64,([A-Za-z0-9+/=\r\n]+)$/i);
      if (!match) { fail(); return; }
      try { const bytes = decode(match[1].replace(/\s/g, '')); cleanup(); resolve(bytes); }
      catch { fail(); }
    };
    try { reader.readAsDataURL(value as Blob); } catch { fail(); }
  });
}
