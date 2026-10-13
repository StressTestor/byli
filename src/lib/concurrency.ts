/**
 * Run `worker` over `items` with at most `limit` calls in flight.
 *
 * Workers own their recoverable errors. Anything a worker throws is treated
 * as fatal: no further items are dispatched, in-flight workers are allowed to
 * finish, and the first error is rethrown.
 *
 * `shouldContinue` is checked before each dispatch (e.g. a time budget).
 * Returns the number of items that were never dispatched because of it.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  shouldContinue: () => boolean = () => true,
): Promise<number> {
  let next = 0;
  let stopped = false;
  let failure: { error: unknown } | null = null;

  const lane = async () => {
    while (!failure && !stopped && next < items.length) {
      if (!shouldContinue()) {
        stopped = true;
        break;
      }
      const item = items[next++];
      try {
        await worker(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  };

  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane);
  await Promise.all(lanes);

  if (failure) throw (failure as { error: unknown }).error;
  return items.length - next;
}
