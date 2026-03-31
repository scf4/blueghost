import { stdout } from "node:process";

const USE_COLOR = stdout.isTTY ?? false;

function ansi(code: string, text: string): string {
  return USE_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const fmt = {
  bold: (text: string) => ansi("1", text),
  dim: (text: string) => ansi("2", text),
  green: (text: string) => ansi("32", text),
  yellow: (text: string) => ansi("33", text),
  red: (text: string) => ansi("31", text),
  cyan: (text: string) => ansi("36", text),
};

export function banner() {
  const ghost = USE_COLOR ? "\x1b[34m\x1b[1m" : "";
  const reset = USE_COLOR ? "\x1b[0m" : "";
  const dim = USE_COLOR ? "\x1b[2m" : "";

  console.log("");
  console.log(`${ghost}  blueghost${reset}  ${dim}registry quarantine proxy${reset}`);
  console.log("");
}

export function section(title: string) {
  console.log(`  ${fmt.bold(title)}`);
}

export function item(label: string, value: string, ok = true) {
  const marker = ok ? fmt.green("*") : fmt.dim("-");
  console.log(`  ${marker} ${fmt.dim(label)} ${value}`);
}

export function success(text: string) {
  console.log(`  ${fmt.green("*")} ${text}`);
}

export function warn(text: string) {
  console.log(`  ${fmt.yellow("!")} ${text}`);
}

export function fail(text: string) {
  console.log(`  ${fmt.red("x")} ${text}`);
}

export function gap() {
  console.log("");
}
