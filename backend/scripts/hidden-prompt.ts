// Reads a secret from the terminal without echoing it. Shared by the CLIs in
// this folder; only meaningful when stdin is a TTY — callers check that first.
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) process.stdout.write(chunk);
        callback();
      },
    });
    const rl = createInterface({ input: process.stdin, output, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}
