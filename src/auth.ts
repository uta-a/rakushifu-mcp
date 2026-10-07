import { createHash, timingSafeEqual } from 'node:crypto';
import type { Credentials } from './config.js';

/**
 * Claude のコネクタの Request headers で渡された、らくしふの認証情報を読む。
 * コネクタで使えるヘッダー名は Anthropic が承認したものに限られるため、標準的な名前を流用している
 * （x-api-key に従業員コード、x-auth-token にパスワード）。
 * 値の検証（長さなど）はログイン時に行う。
 */
export function extractCredentialHeaders(request: Request): Partial<Credentials> {
  return {
    employeeCode: request.headers.get('x-api-key') || undefined,
    password: request.headers.get('x-auth-token') || undefined,
  };
}

/**
 * リクエストからトークンを取り出す。
 * Request headers を使えないクライアント向けに URL の `key` を優先し、無ければ Authorization: Bearer を見る。
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
