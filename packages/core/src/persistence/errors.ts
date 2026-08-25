export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceError";
  }
}

export class PersistenceConfigurationError extends PersistenceError {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceConfigurationError";
  }
}
