import { config } from "./config";
import { handleNpmRequest } from "./registry/npm";
import { handlePypiRequest, isPypiPath } from "./registry/pypi";

export async function handleProxyRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  try {
    if (isPypiPath(url.pathname)) {
      if (!config.enablePython) {
        return new Response("python support is disabled", { status: 503 });
      }
      return await handlePypiRequest(req, url);
    }

    return await handleNpmRequest(req, url);
  } catch (err) {
    console.error(`[error] ${url.pathname}:`, err);
    return new Response("upstream error", { status: 502 });
  }
}
