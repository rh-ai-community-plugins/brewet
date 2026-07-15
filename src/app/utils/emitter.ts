type TransferEventMap = {
  'transfer:started': { jobId: string; destination: string };
  'transfer:completed': { jobId: string; destination: string };
  'transfer:cancelled': { jobId: string };
};

type EventHandler<T> = (data: T) => void;

class TypedEventEmitter {
  private listeners = new Map<string, Set<EventHandler<never>>>();

  on<K extends keyof TransferEventMap>(event: K, handler: EventHandler<TransferEventMap[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler<never>);
  }

  off<K extends keyof TransferEventMap>(event: K, handler: EventHandler<TransferEventMap[K]>): void {
    this.listeners.get(event)?.delete(handler as EventHandler<never>);
  }

  emit<K extends keyof TransferEventMap>(event: K, data: TransferEventMap[K]): void {
    this.listeners.get(event)?.forEach((handler) => handler(data as never));
  }
}

export const transferEmitter = new TypedEventEmitter();
