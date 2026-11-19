// Reads a secret from the terminal without echoing it. Shared by the CLIs in
// this folder; only meaningful when stdin is a TTY — callers check that first.
//
// Input typed BEFORE the prompt is never the answer (KI-088). These commands
// take several seconds to start (npm, then tsx), and until echo is off the
// terminal shows in plain text whatever is typed, then hands it over as the
// start of the answer. So on a TTY the FIRST hidden prompt on an input first
// turns echo off (raw mode), then reads for a moment and drops what was already
// waiting, says so in one line when that was more than a bare Enter, and only
// then asks the question. The later prompts on the same input (the "Repeat
// the password" of the bootstrap commands) do not drain: the start-up delay is
// over and echo has been off since the first one, so what arrives early there
// is typing ahead — a password manager that types `pw⏎pw⏎` — and is kept.
// The record is per input stream (a WeakSet): one process has one stdin, so
// that is once per process, and each fake terminal of the tests starts fresh.
// Ctrl+C (or Ctrl+D on an empty line) at the question closes readline without
// an answer: the promise never settles and the process simply drains
// (platform-enable-mfa.ts relies on that). A Ctrl+C or Ctrl+D among the
// dropped keys (typed in that moment, after echo went off) ends the prompt the
// same way, before the question is shown — a Ctrl+D ANYWHERE in the dropped
// keys, while readline only closes on a Ctrl+D at an empty line: kept on
// purpose and harmless, since everything before it is dropped anyway, so the
// answer's line is still empty. Input that is not a TTY is never drained.
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/** How long the prompt reads and drops what was typed before it, in milliseconds. */
export const EARLY_INPUT_DRAIN_MS = 100;

/** The line shown when something typed before the prompt was dropped. */
export const EARLY_INPUT_NOTICE = 'Input typed before the prompt was ignored (it may still show above). Type the password now.';

/** Ctrl+C and Ctrl+D as raw mode delivers them. */
const ABORT_KEYS = ['\u0003', '\u0004'];
/** Anything but a bare Enter. */
const TYPED_TEXT = /[^\r\n]/;
/** The inputs whose first hidden prompt has already drained them (process.stdin once per process). */
const drainedInputs = new WeakSet<object>();

/** The streams a prompt talks to: the process's own by default, a fake terminal in the tests. */
export interface PromptStreams {
  input: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown };
  output: NodeJS.WritableStream;
}

export function promptHidden(
  question: string,
  streams: PromptStreams = { input: process.stdin, output: process.stdout },
): Promise<string> {
  const { input, output } = streams;
  if (input.isTTY !== true || drainedInputs.has(input)) return ask(question, streams);
  drainedInputs.add(input);

  // Echo off before anything is read; readline turns raw mode on again itself and off when it closes.
  input.setRawMode?.(true);
  return dropEarlyInput(input).then((dropped) => {
    if (ABORT_KEYS.some((key) => dropped.includes(key))) {
      // As readline does on Ctrl+C (or Ctrl+D on an empty line): raw mode off, input paused, no answer.
      input.setRawMode?.(false);
      return new Promise<string>(() => undefined);
    }
    if (TYPED_TEXT.test(dropped)) {
      const onNewLine = dropped.endsWith('\n') || dropped.endsWith('\r');
      output.write(`${onNewLine ? '' : '\n'}${EARLY_INPUT_NOTICE}\n`);
    }
    return ask(question, streams);
  });
}

/** Reads whatever arrives for EARLY_INPUT_DRAIN_MS and returns it, then leaves the input paused. */
function dropEarlyInput(input: PromptStreams['input']): Promise<string> {
  return new Promise((resolve) => {
    let dropped = '';
    const drop = (chunk: Buffer | string) => {
      dropped += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    };
    input.on('data', drop);
    input.resume();
    setTimeout(() => {
      input.removeListener('data', drop);
      input.pause();
      resolve(dropped);
    }, EARLY_INPUT_DRAIN_MS);
  });
}

/** The question itself: the prompt is shown, every key after it is muted; Ctrl+C or Ctrl+D closes readline without an answer. */
function ask(question: string, { input, output }: PromptStreams): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const echo = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) output.write(chunk);
        callback();
      },
    });
    const rl = createInterface({ input, output: echo, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      output.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}
