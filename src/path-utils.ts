import path from "node:path";

export function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

export function fromPosixPath(root: string, value: string): string {
  return path.join(root, ...value.split(path.posix.sep));
}
