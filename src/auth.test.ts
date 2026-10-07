import { describe, expect, it } from 'vitest';
import { extractToken, isAuthorized } from './auth.js';

const TOKEN = 'a'.repeat(40);
const URL_BASE = 'https://example.vercel.app/api/mcp';

describe('extractToken', () => {
  it('URL の key を読む', () => {
    expect(extractToken(new Request(`${URL_BASE}?key=abc`))).toBe('abc');
  });

  it('Authorization: Bearer を読む', () => {
    expect(extractToken(new Request(URL_BASE, { headers: { Authorization: 'Bearer abc' } }))).toBe('abc');
  });

  it('どちらも無ければ undefined', () => {
    expect(extractToken(new Request(URL_BASE))).toBeUndefined();
  });
});

describe('isAuthorized', () => {
  it('一致するトークンを受け付ける', () => {
    expect(isAuthorized(new Request(`${URL_BASE}?key=${TOKEN}`), TOKEN)).toBe(true);
    expect(isAuthorized(new Request(URL_BASE, { headers: { Authorization: `Bearer ${TOKEN}` } }), TOKEN)).toBe(true);
  });

  it('違うトークン、長さの違うトークン、トークン無しを拒否する', () => {
    expect(isAuthorized(new Request(`${URL_BASE}?key=${'b'.repeat(40)}`), TOKEN)).toBe(false);
    expect(isAuthorized(new Request(`${URL_BASE}?key=${TOKEN}x`), TOKEN)).toBe(false);
    expect(isAuthorized(new Request(URL_BASE), TOKEN)).toBe(false);
  });
});
