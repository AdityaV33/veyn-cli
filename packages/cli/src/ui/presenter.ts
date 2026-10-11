const isColorEnabled = () => process.stdout.isTTY && !process.env.NO_COLOR;

export const colors = {
  get reset() { return isColorEnabled() ? "\x1b[0m" : ""; },
  get bold() { return isColorEnabled() ? "\x1b[1m" : ""; },
  get dim() { return isColorEnabled() ? "\x1b[2m" : ""; },
  get italic() { return isColorEnabled() ? "\x1b[3m" : ""; },
  get underline() { return isColorEnabled() ? "\x1b[4m" : ""; },
  get black() { return isColorEnabled() ? "\x1b[30m" : ""; },
  get red() { return isColorEnabled() ? "\x1b[31m" : ""; },
  get green() { return isColorEnabled() ? "\x1b[32m" : ""; },
  get yellow() { return isColorEnabled() ? "\x1b[33m" : ""; },
  get blue() { return isColorEnabled() ? "\x1b[34m" : ""; },
  get magenta() { return isColorEnabled() ? "\x1b[35m" : ""; },
  get cyan() { return isColorEnabled() ? "\x1b[36m" : ""; },
  get white() { return isColorEnabled() ? "\x1b[37m" : ""; },
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
