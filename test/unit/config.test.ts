import { expect, test } from "bun:test";

import { config } from "../../src/config";

test("Python is disabled by default unless explicitly enabled", () => {
  expect(config.enablePython).toBeFalse();
});
