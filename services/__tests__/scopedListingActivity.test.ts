// Deterministic hook-state harness, not a native React rendering/interaction test.
let mockActivity: any;
let mockOwner: { current: string | null };
jest.mock('react', () => ({
  useRef: () => mockOwner,
  useState: (initial: any) => {
    if (mockActivity === undefined) mockActivity = initial;
    return [mockActivity, (next: any) => { mockActivity = typeof next === 'function' ? next(mockActivity) : next; }];
  },
}));
import { useScopedListingActivity } from '@/hooks/useScopedListingActivity';
beforeEach(() => { mockActivity = undefined; mockOwner = { current: null }; });
test('generation in one module never marks the next editor as busy', () => {
  const old = useScopedListingActivity('user:tenant:coins:1:listing');
  old.actionLock.current = true; old.setBusy(true); old.setGenerating('title');
  expect(useScopedListingActivity('user:tenant:coins:1:listing')).toMatchObject({ busy: true, generating: 'title' });
  expect(useScopedListingActivity('user:tenant:tech:2:other')).toMatchObject({ busy: false, generating: null });
});
test('late old cleanup cannot unlock or clear another listing operation', () => {
  const old = useScopedListingActivity('old-scope'); old.actionLock.current = true; old.setBusy(true); old.setGenerating('title');
  const next = useScopedListingActivity('new-scope'); next.actionLock.current = true; next.setBusy(true); next.setGenerating('description');
  old.actionLock.current = false; old.setBusy(false); old.setGenerating(null);
  expect(next.actionLock.current).toBe(true);
  expect(useScopedListingActivity('new-scope')).toMatchObject({ busy: true, generating: 'description' });
  next.actionLock.current = false; next.setBusy(false); next.setGenerating(null);
  expect(useScopedListingActivity('new-scope')).toMatchObject({ busy: false, generating: null });
});
