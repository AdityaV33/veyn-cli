export class ParserError extends Error {
  constructor(public readonly filePath: string, message: string) {
    super(`ParserError [${filePath}]: ${message}`);
    this.name = "ParserError";
  }
}

export class UnsupportedExtensionError extends ParserError {
  constructor(filePath: string) {
    super(filePath, "Unsupported extension. Only .ts and .tsx files are supported.");
    this.name = "UnsupportedExtensionError";
  }
}
