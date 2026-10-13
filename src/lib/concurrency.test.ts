import { describe, it, expect } from 'vitest';
import { runWithConcurrency } from './concurrency';

const tick = () => new Promise(resolve => setTimeout(resolve, 1));

describe('runWithConcurrency', () => {
  it('processes every item with at most `limit` workers in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];

    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async n => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      seen.push(n);
      inFlight--;
    });

    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it('stops dispatching after a worker throws, waits for in-flight work, then rethrows', async () => {
    const started: number[] = [];
    const finished: number[] = [];

    await expect(
      runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async n => {
        started.push(n);
        if (n === 1) throw new Error('boom');
        await tick();
        finished.push(n);
      }),
    ).rejects.toThrow('boom');

    // Item 2 was already in flight and is allowed to finish; nothing after it starts.
    expect(started).toEqual([1, 2]);
    expect(finished).toEqual([2]);
  });

  it('stops dispatching once shouldContinue returns false', async () => {
    const seen: number[] = [];
    let calls = 0;
    const skipped = await runWithConcurrency(
      [1, 2, 3, 4],
      1,
      async n => { seen.push(n); },
      () => ++calls <= 2,
    );
    expect(seen).toEqual([1, 2]);
    expect(skipped).toBe(2);
  });

  it('handles an empty list', async () => {
    expect(await runWithConcurrency([], 3, async () => {})).toBe(0);
  });
});
