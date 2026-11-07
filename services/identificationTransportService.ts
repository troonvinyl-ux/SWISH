// A single bounded request; never replay a paid identification after an ambiguous failure.
import {recordPerformance} from './performanceMonitoringService';
export class IdentificationTimeoutError extends Error {
  constructor() {
    super('Photo identification timed out. Your photos and barcode results are retained. Retry Identify; no inventory save was requested.');
    this.name = 'IdentificationTimeoutError';
  }
}

export function invokeWithIdentificationDeadline<T>(operation: (signal: AbortSignal) => PromiseLike<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error('A valid identification deadline is required.'));
  const controller = new AbortController();
  const started=Date.now();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      finish(() => {
        controller.abort();
        recordPerformance('identification',Date.now()-started,'failure');
        reject(new IdentificationTimeoutError());
      });
    }, timeoutMs);
    void Promise.resolve().then(() => operation(controller.signal)).then(
      result => finish(() => {recordPerformance('identification',Date.now()-started,(result as {error?:unknown})?.error?'failure':'success');resolve(result);}),
      error => finish(() => {recordPerformance('identification',Date.now()-started,'failure');reject(error);}),
    );
  });
}
