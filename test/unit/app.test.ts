import { expect, test } from "bun:test";

import { handleProxyRequest } from "../../src/app";

test("healthz responds locally without proxying upstream", async () => {
  const response = await handleProxyRequest(
    new Request("http://127.0.0.1:4873/healthz"),
  );

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("ok");
});
