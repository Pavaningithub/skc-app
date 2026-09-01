// ─── HTTP client for the SKC assistant API ───────────────────────────────────

export interface SkcConfig {
  baseUrl: string;
  token: string;
}

/**
 * An unexpanded `${VAR}` placeholder. .mcp.json passes `"${SKC_API_URL}"`, and
 * when the variable is not set in the environment the literal string arrives
 * instead — non-empty, so a plain emptiness check misses it and the failure
 * surfaces later as an unhelpful "Invalid URL".
 */
function isUnexpanded(value: string): boolean {
  return /^\$\{[A-Z_][A-Z0-9_]*\}$/i.test(value.trim());
}

const SETUP_HINT =
  "Run ./tools/setup-assistant.sh, then `source .skc-assistant.env` and restart " +
  "the MCP client so it inherits the variables.";

export function readConfig(): SkcConfig {
  const rawUrl = (process.env.SKC_API_URL || "").trim();
  const token = (process.env.SKC_API_TOKEN || "").trim();

  if (!rawUrl || isUnexpanded(rawUrl)) {
    throw new Error(
      `SKC_API_URL is not set${isUnexpanded(rawUrl) ? " (it arrived as the literal \"" + rawUrl + "\", so the variable is missing from the environment)" : ""}. ` +
      "It should point at the deployed skcApi function, e.g. " +
      `https://asia-south1-<project>.cloudfunctions.net/skcApi. ${SETUP_HINT}`,
    );
  }
  if (!token || isUnexpanded(token)) {
    throw new Error(
      `SKC_API_TOKEN is not set${isUnexpanded(token) ? " (it arrived as the literal \"" + token + "\", so the variable is missing from the environment)" : ""}. ` +
      `It must match the SKC_API_TOKEN Firebase secret. ${SETUP_HINT}`,
    );
  }

  const baseUrl = rawUrl.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(
      `SKC_API_URL is not a valid URL: "${baseUrl}". ` +
      "It should look like https://asia-south1-<project>.cloudfunctions.net/skcApi.",
    );
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error(
      `SKC_API_URL must use https (got "${parsed.protocol}//"). ` +
      "The API token is sent as a header and would otherwise travel in the clear.",
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
      // X-SKC-Token, not Authorization: Firebase HTTP functions reserve the
      // Authorization header for Firebase ID tokens and strip anything else,
      // so a bearer token never reaches the function.
      "X-SKC-Token": config.token,
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
