export function heading(label: string): void {
  console.log(label);
}

export function field(label: string, value: string | number): void {
  console.log(`${label}: ${value}`);
}

export function success(message: string): void {
  console.log(`[ok] ${message}`);
}

export function warn(message: string): void {
  console.log(`[warn] ${message}`);
}

export function item(message: string): void {
  console.log(`  - ${message}`);
}

export function empty(): void {
  console.log("  none");
}
