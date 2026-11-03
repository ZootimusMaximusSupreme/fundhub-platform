import { tap } from "node:test/reporters";

// Act on Node's typed failure events, never strings printed by tests. Stream
// every event through the built-in TAP reporter without buffering or filtering.
export default async function* (source) {
  async function* checked() {
    for await (const event of source) {
      if (event.type === "test:fail") process.exitCode = 1;
      yield event;
    }
  }
  yield* tap(checked());
}
