/** Deadlines release UI locks only; they do not claim that a server write was cancelled. */
export const scannerDeadlines = { camera: 15000, barcode: 45000, operation: 120000 } as const;

export function withScannerDeadline<T>(work: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(work).then(
      value => { clearTimeout(timer); resolve(value); },
      cause => { clearTimeout(timer); reject(cause); },
    );
  });
}

/** Inactive is commonly the permission/photo picker. Only true backgrounding suspends capture. */
export function scannerShouldSuspend(state: string): boolean {
  return state === 'background';
}
