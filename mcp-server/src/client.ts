// ─── HTTP client for the SKC assistant API ───────────────────────────────────

export interface SkcConfig {
  baseUrl: string;
  token: string;
}

export function readConfig(): SkcConfig {
  const baseUrl = (process.env.SKC_API_URL || "").replace(/\/+$/, "");
  const token = process.env.SKC_API_TOKEN || "";
  if (!baseUrl) {
    throw new Error(
      "SKC_API_URL is not set. Point it at the deployed skcApi function, e.g. " +
      "https://asia-south1-<project>.cloudfunctions.net/skcApi",
    );
  }
  if (!token) {
    throw new Error(
      "SKC_API_TOKEN is not set. Use the same value you gave " +
      "`firebase functions:secrets:set SKC_API_TOKEN`.",
    );
  }
  return { baseUrl, token };
}

/** Call one API route. Read routes use GET, write routes POST. */
export async function callApi(
  config: SkcConfig,
  route: string,
  params: Record<string, unknown> = {},
  method: "GET" | "POST" = "GET",
): Promise<unknown> {
  const url = new URL(`${config.baseUrl}/${route}`);
  const init: RequestInit = {
    method,
    headers: {
      "Authorization": `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
  };
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  } else {
    init.body = JSON.stringify(params);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(
      `Could not reach the SKC API at ${config.baseUrl}. ` +
      `Check SKC_API_URL and that the skcApi function is deployed. (${String(err)})`,
    );
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`SKC API returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    const message = (body as { error?: string }).error || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      throw new Error(`${message} — SKC_API_TOKEN does not match the deployed secret.`);
    }
    throw new Error(message);
  }
  return body;
}
