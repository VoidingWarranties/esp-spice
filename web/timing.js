/**
 * @fileoverview Waits for the run loops of the workers.
 */

/**
 * @param {number} ms
 * @return {!Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lets queued messages in. Unlike setTimeout(0), a message is not delayed
 * by 4 ms when timeouts nest.
 *
 * @return {!Promise<void>}
 */
export function yieldToEvents() {
  const {port1, port2} = new MessageChannel();
  return new Promise((resolve) => {
    port1.onmessage = () => resolve();
    port2.postMessage(null);
  });
}
