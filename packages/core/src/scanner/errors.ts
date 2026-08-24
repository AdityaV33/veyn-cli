export class ScannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScannerError";
    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class PathNotFoundError extends ScannerError {
  constructor(path: string) {
    super(`Repository path does not exist: ${path}`);
    this.name = "PathNotFoundError";
  }
}

export class NotDirectoryError extends ScannerError {
  constructor(path: string) {
    super(`Repository path is not a directory: ${path}`);
    this.name = "NotDirectoryError";
  }
}
