const locks = new Map<string, Promise<unknown>>();

/**
 * Serialize work on a specific approval id. Two concurrent IPC calls for the
 * same id queue behind each other; concurrent calls for different ids run in
 * parallel. The previous implementation of approveConnectorCall did a
 * check-then-execute with no lock — a double-click could re-fire a staged
 * DELETE/POST.
 *
 * The lock entry is pruned once the last caller drains, so this Map doesn't
 * grow unbounded over the app's lifetime.
 */
export async function withApprovalLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(id);
  const myTurn = previous ? previous.then(() => undefined, () => undefined) : Promise.resolve();

  const result = myTurn.then(fn);
  const tail = result.then(() => undefined, () => undefined);
  locks.set(id, tail);

  try {
    return await result;
  } finally {
    if (locks.get(id) === tail) {
      locks.delete(id);
    }
  }
}
