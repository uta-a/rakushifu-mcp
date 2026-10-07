export function extractCookies(headers: Headers): string[] {
  const cookies: string[] = [];
  headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      cookies.push(value);
    }
  });
  return cookies;
}

export function getSetCookies(headers: Headers): string[] {
  return headers.getSetCookie?.() ?? extractCookies(headers);
}

export function parseCookieValue(setCookieHeaders: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const header of setCookieHeaders) {
    const match = header.match(/^([^=]+)=([^;]*)/);
    if (match) {
      result[match[1].trim()] = match[2].trim();
    }
  }
  return result;
}

export function buildCookieString(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}
