export class CallExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallExtractionError";
  }
}
