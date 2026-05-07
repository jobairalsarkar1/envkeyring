import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs";

let nonTtyAnswers: string[] | null = null;

export async function askSecret(label: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    return askNonTty(label);
  }

  return new Promise((resolve) => {
    let value = "";

    readline.emitKeypressEvents(input);
    const wasRaw = input.isRaw;
    const refableInput = input as typeof input & { ref?: () => void };
    refableInput.ref?.();
    input.resume();
    input.setRawMode(true);
    output.write(label);

    const cleanup = () => {
      input.setRawMode(wasRaw);
      input.off("keypress", onKeypress);
      input.pause();
    };

    const onKeypress = (_chunk: string, key: readline.Key) => {
      if (key.name === "return" || key.name === "enter") {
        output.write("\n");
        cleanup();
        resolve(value);
        return;
      }

      if (key.name === "backspace") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          output.write("\b \b");
        }
        return;
      }

      if (key.ctrl && key.name === "c") {
        output.write("\n");
        cleanup();
        process.exit(130);
      }

      if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
        value += key.sequence;
        output.write("*");
      }
    };

    input.on("keypress", onKeypress);
  });
}

async function askNonTty(label: string): Promise<string> {
  output.write(label);
  nonTtyAnswers ??= fs.readFileSync(0, "utf8").split(/\r?\n/);
  return nonTtyAnswers.shift() ?? "";
}
