/// <reference lib="webworker" />
import { leadingZeroBits, sha256Words } from "./sha256";

// Searches for a nonce so that SHA-256(`${challenge}:${nonce}`) has `difficulty` leading zero bits.
self.onmessage = (event: MessageEvent<{ challenge: string; difficulty: number }>) => {
  const { challenge, difficulty } = event.data;
  const started = performance.now();
  for (let nonce = 0; nonce < 1e12; nonce++) {
    if (leadingZeroBits(sha256Words(`${challenge}:${nonce}`)) >= difficulty) {
      self.postMessage({ nonce: String(nonce), attempts: nonce + 1, ms: performance.now() - started });
      return;
    }
  }
};
