import { useEffect, useState } from "react";

/**
 * Fetches the WS authentication token from /api/ws-token.
 * Returns null until the token is available.
 */
export function useWsToken(): string | null {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ws-token")
      .then((r) => r.json())
      .then((d) => {
        if (d.token) setToken(d.token);
      })
      .catch(() => {});
  }, []);

  return token;
}
