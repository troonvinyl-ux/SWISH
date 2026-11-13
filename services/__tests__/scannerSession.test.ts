// Pure visit lifecycle and source-wiring tests; no device, AI or inventory writes.
import fs from 'node:fs';
import modules from '../../niche-modules.json';
import { createEmptyCaptureDraft, createScannerSession } from '../scannerSessionService';

const source = (path: string) => fs.readFileSync(path, 'utf8');

describe('Shared scanner physical-item sessions', () => {
  test.each(Object.entries(modules.products))('%s opens with no previous identification or inventory ID', (_niche, product) => {
    const fresh = createEmptyCaptureDraft(product.specialists[0]);
    expect(fresh).toEqual({ images: [], result: null, savedId: null, mode: 'item', specialistId: product.specialists[0], answers: {} });
    expect(fresh.musicRelease).toBeUndefined();
  });

  test('empty drafts do not share mutable photos or review answers', () => {
    const first = createEmptyCaptureDraft('collectibles');
    first.images.push({ uri: 'file://old-bear.jpg', slotId: 'main', slotLabel: 'Main item' });
    first.savedId = 'previous-inventory-id';
    first.answers._title = 'Old identification';
    expect(createEmptyCaptureDraft('collectibles')).toMatchObject({ images: [], savedId: null, result: null, answers: {} });
  });

  test('returning to the same user, tenant and niche still gets a new token', () => {
    const session = createScannerSession();
    const first = session.begin('user:tenant:collectibles:1');
    session.end(first);
    expect(session.isCurrent(first)).toBe(false);
    const second = session.begin('user:tenant:collectibles:1');
    expect(second).not.toBe(first);
    expect(session.isCurrent(first)).toBe(false);
    expect(session.isCurrent(second)).toBe(true);
  });

  test('new scan invalidates old callbacks even without leaving the screen', () => {
    const session = createScannerSession();
    const first = session.begin('scope');
    const second = session.begin('scope');
    session.end(first);
    expect(session.isCurrent(second)).toBe(true);
    expect(session.isCurrent(first)).toBe(false);
  });

  test('late photo, identification and save callbacks cannot repopulate the new scan', async () => {
    const session = createScannerSession();
    const first = session.begin('user:tenant:collectibles');
    let complete: (() => void) | undefined;
    const delayed = new Promise<void>(resolve => { complete = resolve; });
    const commit = jest.fn();
    const releaseBusy = jest.fn();
    const pending = delayed.then(() => {
      if (session.isCurrent(first)) { commit({ savedId: 'old-id', images: ['old-photo'], result: 'old-identification' }); releaseBusy(); }
    });
    session.end(first);
    const second = session.begin('user:tenant:collectibles');
    complete?.();
    await pending;
    expect(commit).not.toHaveBeenCalled();
    expect(releaseBusy).not.toHaveBeenCalled();
    expect(session.isCurrent(second)).toBe(true);
  });

  test.each(['another-user:tenant:niche:1', 'user:another-tenant:niche:1', 'user:tenant:another-niche:1', 'user:tenant:niche:2'])('changing access scope to %s rejects prior results', nextScope => {
    const session = createScannerSession();
    const old = session.begin('user:tenant:niche:1');
    session.begin(nextScope);
    expect(session.isCurrent(old)).toBe(false);
  });

  test('inactive tokens are never current', () => {
    const session = createScannerSession();
    expect(session.isCurrent('')).toBe(false);
    const first = session.begin('scope');
    session.end(first);
    expect(session.isCurrent(first)).toBe(false);
  });

  test('all scanners use the shared visit reset rather than automatic local hydration', () => {
    const hook = source('hooks/useGenericCapture.ts');
    expect(hook).toContain('useScannerSession(');
    expect(hook).toContain('setRecovery(');
    expect(hook).toContain('const saved=recovery.draft');
    expect(hook).toContain('Retained scan belongs to another specialist');
    expect(hook).toContain('setDraft(fresh)');
    expect(hook).toContain('savedId:visible.savedId');
    expect(hook).toContain('if(current.current===scope){setDraft(savedDraft)');
    expect(hook).toContain('id=response.item.id');
    expect(hook).toContain('persistCapturedItemPhotos(tenant.id,id,visible.images)');
    expect(hook).toContain('if(!upload.complete');
    expect(source('hooks/useScannerSession.ts')).toContain('useFocusEffect');
    expect(source('app/(tabs)/scan.tsx')).toContain('PremiumScanner');
    expect(source('app/antique-capture.tsx')).toContain('<PremiumScanner');
  });

  test('viewfinder and upper reset control are shared, including Collectibles', () => {
    const scanner = source('components/feature/PremiumScanner.tsx');
    expect(scanner).not.toContain('compactCollectibles');
    expect(scanner).toContain('<SharedCaptureCamera sessionId={capture.sessionId}');
    expect(scanner).toContain('Start a new scan and clear the current identification');
    const camera = source('hooks/usePremiumCamera.ts');
    expect(camera).toContain('[capture.sessionId]');
    expect(camera).toContain('if (!isCurrent()) return;');
    expect(camera).toContain('if(flight.current===sessionId)');
  });
});
