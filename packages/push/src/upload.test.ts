import { afterEach, describe, expect, it, vi } from 'vitest';
import { cutText, messageOf } from './upload.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the message a notification carries', () => {
  it('cuts long text by whole characters, never half an emoji (audit 4 F3-4)', () => {
    expect(cutText('Dentist', 200)).toBe('Dentist');
    // 199 letters and an emoji: the emoji's two halves are the 200th and 201st.
    const title = `${'a'.repeat(199)}🦷 at 10`;
    expect(cutText(title, 200)).toBe('a'.repeat(199));
    expect(cutText(`${'a'.repeat(198)}🦷 at 10`, 200)).toBe(`${'a'.repeat(198)}🦷`);
    // A flag (two letter symbols) and a family (four people) stay whole too.
    expect(cutText(`${'a'.repeat(198)}🇬🇪!`, 200)).toBe('a'.repeat(198));
    expect(cutText(`${'a'.repeat(195)}👨‍👩‍👧‍👦`, 200)).toBe('a'.repeat(195));
    expect(cutText('🦷', 0)).toBe('');
    const message = JSON.parse(
      new TextDecoder().decode(messageOf({ title, body: '🌱'.repeat(300), tag: 't' })),
    ) as { title: string; body: string };
    expect(message.title).toBe('a'.repeat(199));
    expect(message.body).toBe('🌱'.repeat(250));
  });

  it('never leaves half an emoji where the browser can’t tell characters apart', async () => {
    // Firefox before 125 has no Intl.Segmenter.
    vi.stubGlobal(
      'Intl',
      Object.assign(Object.create(Intl) as typeof Intl, { Segmenter: undefined }),
    );
    vi.resetModules();
    const old = await import('./upload.ts');
    expect(old.cutText(`${'a'.repeat(199)}🦷 at 10`, 200)).toBe('a'.repeat(199));
    expect(old.cutText(`${'a'.repeat(198)}🦷 at 10`, 200)).toBe(`${'a'.repeat(198)}🦷`);
  });
});
