// The hidden password prompt of the CLIs (KI-088): what was typed before the
// question appeared is dropped, never taken as the answer; echo is off before
// anything is read; Ctrl+C / Ctrl+D still close the prompt without an answer.
// A fake terminal: a PassThrough with isTTY and a recorded setRawMode.
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { EARLY_INPUT_NOTICE, promptHidden } from './hidden-prompt.js';

const QUESTION = 'Password (not echoed): ';

interface FakeTerminal {
  input: PassThrough & { isTTY?: boolean; isRaw: boolean; setRawMode?: (mode: boolean) => unknown };
  output: Writable;
  /** Everything written to the output so far. */
  shown(): string;
  /** Each setRawMode call with the number of input bytes still unread at that moment. */
  rawModes: { mode: boolean; unread: number }[];
}

function fakeTerminal({ tty = true }: { tty?: boolean } = {}): FakeTerminal {
  let shown = '';
  const rawModes: FakeTerminal['rawModes'] = [];
  const input = Object.assign(new PassThrough(), { isRaw: false }) as FakeTerminal['input'];
  if (tty) {
    input.isTTY = true;
    input.setRawMode = (mode: boolean) => {
      rawModes.push({ mode, unread: input.readableLength });
      input.isRaw = mode;
      return input;
    };
  }
  const output = new Writable({
    write(chunk, _encoding, callback) {
      shown += String(chunk);
      callback();
    },
  });
  return { input, output, shown: () => shown, rawModes };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the prompt');
    await sleep(5);
  }
}

/** 'pending' when the promise has not settled within `ms`. */
async function stateAfter(promise: Promise<unknown>, ms = 300): Promise<'settled' | 'pending'> {
  return Promise.race([promise.then(() => 'settled' as const, () => 'settled' as const), sleep(ms).then(() => 'pending' as const)]);
}

describe('promptHidden (KI-088)', () => {
  it('drops what was typed before the prompt appeared and answers with what is typed after it — saying so once', async () => {
    const term = fakeTerminal();
    term.input.write('typed-too-early');
    const answer = promptHidden(QUESTION, term);
    await until(() => term.shown().includes(QUESTION));
    term.input.write('s3cret-after\r');

    await expect(answer).resolves.toBe('s3cret-after');
    const shown = term.shown();
    expect(shown.split(EARLY_INPUT_NOTICE)).toHaveLength(2);
    // The notice starts on a line of its own and comes before the question.
    expect(shown.indexOf(`\n${EARLY_INPUT_NOTICE}\n`)).toBeGreaterThanOrEqual(0);
    expect(shown.indexOf(EARLY_INPUT_NOTICE)).toBeLessThan(shown.indexOf(QUESTION));
    // Nothing typed is echoed, before or after the question.
    expect(shown).not.toContain('typed-too-early');
    expect(shown).not.toContain('s3cret-after');
  });

  it('drops a whole line typed before the prompt — it is not answered before the question is even asked', async () => {
    const term = fakeTerminal();
    term.input.write('early-line\r');
    const answer = promptHidden(QUESTION, term);
    expect(await stateAfter(answer, 50)).toBe('pending');
    await until(() => term.shown().includes(QUESTION));
    term.input.write('right\r');

    await expect(answer).resolves.toBe('right');
    expect(term.shown()).toContain(EARLY_INPUT_NOTICE);
  });

  it('turns echo off before it reads anything, and back on when the answer is in', async () => {
    const term = fakeTerminal();
    term.input.write('early');
    const answer = promptHidden(QUESTION, term);
    await until(() => term.shown().includes(QUESTION));
    term.input.write('pw\r');
    await answer;

    expect(term.rawModes[0]).toEqual({ mode: true, unread: 'early'.length });
    expect(term.rawModes.at(-1)?.mode).toBe(false);
    expect(term.input.isRaw).toBe(false);
  });

  it('drops an early bare Enter without the notice, and shows no notice when nothing was typed early', async () => {
    const enter = fakeTerminal();
    enter.input.write('\r\n');
    const first = promptHidden(QUESTION, enter);
    await until(() => enter.shown().includes(QUESTION));
    enter.input.write('first\r');
    await expect(first).resolves.toBe('first');
    expect(enter.shown()).not.toContain(EARLY_INPUT_NOTICE);

    const quiet = fakeTerminal();
    const second = promptHidden(QUESTION, quiet);
    await until(() => quiet.shown().includes(QUESTION));
    quiet.input.write('second\r');
    await expect(second).resolves.toBe('second');
    expect(quiet.shown()).not.toContain(EARLY_INPUT_NOTICE);
  });

  it('asks twice in a row, as the bootstrap commands do: each answer is its own line', async () => {
    const term = fakeTerminal();
    const first = promptHidden(QUESTION, term);
    await until(() => term.shown().includes(QUESTION));
    term.input.write('one\r');
    await expect(first).resolves.toBe('one');

    const again = promptHidden('Repeat the password: ', term);
    await until(() => term.shown().includes('Repeat the password: '));
    term.input.write('one\r');
    await expect(again).resolves.toBe('one');
    expect(term.shown()).not.toContain(EARLY_INPUT_NOTICE);
  });

  it('drains only at the first prompt: a second answer typed quickly, before its question shows, is kept (an auto-typing password manager)', async () => {
    const term = fakeTerminal();
    term.input.write('typed-too-early');
    const first = promptHidden(QUESTION, term);
    await until(() => term.shown().includes(QUESTION));
    term.input.write('pw-1\r');
    await expect(first).resolves.toBe('pw-1');

    // The repeat arrives before "Repeat the password: " is even asked — after the first prompt
    // echo is already off, so this is typing ahead, not text echoed during the start-up.
    term.input.write('pw-1\r');
    const again = promptHidden('Repeat the password: ', term);
    const answer = await Promise.race([again, sleep(1000).then(() => 'no answer within 1 s')]);

    expect(answer).toBe('pw-1');
    expect(term.shown().split(EARLY_INPUT_NOTICE)).toHaveLength(2);
    expect(term.rawModes.filter((call) => call.mode).length).toBeGreaterThanOrEqual(2);
  });

  it('Ctrl+C or Ctrl+D at the question still closes the prompt without an answer: the promise never settles, echo is back on, input paused', async () => {
    for (const key of ['\u0003', '\u0004']) {
      const term = fakeTerminal();
      const answer = promptHidden(QUESTION, term);
      await until(() => term.shown().includes(QUESTION));
      term.input.write(key);

      expect(await stateAfter(answer)).toBe('pending');
      expect(term.input.isRaw).toBe(false);
      expect(term.input.isPaused()).toBe(true);
    }
  });

  it('a Ctrl+C typed while echo is already off but before the question ends the prompt without asking', async () => {
    const term = fakeTerminal();
    term.input.write('abc\u0003');
    const answer = promptHidden(QUESTION, term);

    expect(await stateAfter(answer)).toBe('pending');
    expect(term.shown()).not.toContain(QUESTION);
    expect(term.rawModes.map((call) => call.mode)).toEqual([true, false]);
    expect(term.input.isPaused()).toBe(true);
  });

  it('does not drain an input that is not a terminal: what is already there is still the answer', async () => {
    const term = fakeTerminal({ tty: false });
    term.input.write('piped\n');

    await expect(promptHidden(QUESTION, term)).resolves.toBe('piped');
    expect(term.shown()).not.toContain(EARLY_INPUT_NOTICE);
    expect(term.rawModes).toEqual([]);
  });
});
