/**
 * The part that uploads (upload.ts) loads the first time it's needed. When
 * it can't be loaded (a page from an older version whose files are gone,
 * say), it says so, so the switch can ask for a reload (audit 4 J-10).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.doMock('./upload.ts', () => {
    throw new TypeError('Failed to fetch dynamically imported module');
  });
});

/** What `attempt` fails with. */
const failure = (attempt: Promise<unknown>) =>
  attempt.then(
    () => null,
    (error: unknown) => error,
  );

describe('the part that uploads, when it can’t be loaded', () => {
  it('says the app is out of date when uploading', async () => {
    const { PushError, syncPush } = await import('./client.ts');
    const error = await failure(syncPush([]));
    expect(error).toBeInstanceOf(PushError);
    expect((error as InstanceType<typeof PushError>).code).toBe('outdated');
  });

  it('and when sending a test notification', async () => {
    const { PushError, sendTestPush } = await import('./client.ts');
    const error = await failure(sendTestPush('Habits', 'Notifications are working.'));
    expect(error).toBeInstanceOf(PushError);
    expect((error as InstanceType<typeof PushError>).code).toBe('outdated');
  });
});
