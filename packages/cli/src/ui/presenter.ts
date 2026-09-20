export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

export class Presenter {
  static title(title: string) {
    console.log(`\n${colors.bold}Veyn — ${title}${colors.reset}`);
  }

  static section(title: string) {
    console.log(`\n${colors.bold}${title}${colors.reset}`);
  }

  static item(label: string, value: string | number) {
    console.log(`  ${label}: ${value}`);
  }

  static text(text: string, indent: number = 1) {
    const spaces = "  ".repeat(indent);
    console.log(`${spaces}${text}`);
  }

  static dimText(text: string, indent: number = 2) {
    const spaces = "  ".repeat(indent);
    console.log(`${spaces}${colors.dim}${text}${colors.reset}`);
  }

  static warning(text: string, indent: number = 1) {
    const spaces = "  ".repeat(indent);
    console.log(`${spaces}${colors.yellow}⚠ ${text}${colors.reset}`);
  }

  static success(text: string, indent: number = 1) {
    const spaces = "  ".repeat(indent);
    console.log(`${spaces}${colors.green}✓ ${text}${colors.reset}`);
  }

  static error(text: string) {
    console.log(`\n${colors.red}${colors.bold}Error:${colors.reset} ${text}\n`);
  }

  static formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes === 0) return `${seconds}s`;
    return `${minutes}m ${remainingSeconds}s`;
  }

  static step(msg: string) {
    if (process.stdout.isTTY) {
      process.stdout.write(`\r\x1b[K  ${colors.dim}●${colors.reset} ${msg}`);
    } else {
      console.log(`  ● ${msg}`);
    }
  }

  static endStep() {
    if (process.stdout.isTTY) {
      console.log("");
    }
  }
}
