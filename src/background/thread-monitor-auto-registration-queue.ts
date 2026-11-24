export class CodexBridgeAutoRegistrationQueue {
  private storageTail: Promise<void> = Promise.resolve();
  private readonly targetTails = new Map<string, Promise<void>>();

  withStorage<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.storageTail.then(operation, operation);
    this.storageTail = result.then(() => undefined, () => undefined);
    return result;
  }

  withTarget<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.targetTails.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.targetTails.set(key, tail);
    void tail.then(() => { if (this.targetTails.get(key) === tail) this.targetTails.delete(key); });
    return result;
  }
}
