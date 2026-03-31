const REQUEST_TIMEOUT_MS = 15_000;

export function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

export async function fetchUpstream(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: init.signal ?? timeoutSignal(),
  });
}

export function relayResponse(
  res: Response,
  options: { defaultContentType?: string } = {},
): Response {
  const headers = new Headers(res.headers);

  if (options.defaultContentType && !headers.has("Content-Type")) {
    headers.set("Content-Type", options.defaultContentType);
  }

  return new Response(res.body, {
    status: res.status,
    headers,
  });
}
