import path from "node:path";
import React, { useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import { toPosixPath } from "./path-utils.js";

type SealPickerProps = {
  files: string[];
  root: string;
};

export async function chooseEnvFiles(root: string, files: string[]): Promise<string[]> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive seal requires a TTY. Run \"envkeyring seal\" for non-interactive use.");
  }

  const app = render(React.createElement(SealPicker, { files, root }));
  const selected = await app.waitUntilExit();
  return selected as string[];
}

function SealPicker({ files, root }: SealPickerProps): React.ReactElement {
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(() => new Set(files));

  useInput((input, key) => {
    if (key.escape || input === "q") {
      exit([]);
      return;
    }

    if (key.upArrow || input === "k") {
      setCursor((value) => Math.max(0, value - 1));
      return;
    }

    if (key.downArrow || input === "j") {
      setCursor((value) => Math.min(files.length - 1, value + 1));
      return;
    }

    if (input === "a") {
      setSelected((value) => value.size === files.length ? new Set() : new Set(files));
      return;
    }

    if (input === " ") {
      const file = files[cursor];
      setSelected((value) => {
        const next = new Set(value);
        if (next.has(file)) {
          next.delete(file);
        } else {
          next.add(file);
        }
        return next;
      });
      return;
    }

    if (key.return) {
      exit(files.filter((file) => selected.has(file)));
    }
  });

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, { bold: true }, "Select env files to seal"),
    React.createElement(Text, { color: "gray" }, "Use arrows or j/k, space to toggle, a to toggle all, enter to continue, q to cancel."),
    React.createElement(Text, null, ""),
    ...files.map((file, index) => {
      const active = index === cursor;
      const checked = selected.has(file);
      const label = toPosixPath(path.relative(root, file));

      return React.createElement(
        Text,
        { key: file, color: active ? "cyan" : undefined },
        `${active ? ">" : " "} [${checked ? "x" : " "}] ${label}`
      );
    }),
    React.createElement(Text, null, ""),
    React.createElement(Text, { color: selected.size === 0 ? "yellow" : "green" }, `${selected.size} of ${files.length} selected`)
  );
}
