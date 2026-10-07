import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * リクエストからトークンを取り出す。
 * claude.ai のコネクタはヘッダーを設定できないので URL の `key` を優先し、無ければ Authorization: Bearer を見る。
 */
export function extractToken(request: Request): string | undefined {
  const key = new URL(request.url).searchParams.get('key');
  if (key) return key;

  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

/**
 * トークンを定数時間で照合する。長さの違いで早期に返さないよう、ハッシュ同士を比較する。
 */
export function isAuthorized(request: Request, expectedToken: string): boolean {
  const token = extractToken(request);
  if (!token) return false;

  const actual = createHash('sha256').update(token).digest();
  const expected = createHash('sha256').update(expectedToken).digest();
  return timingSafeEqual(actual, expected);
}
