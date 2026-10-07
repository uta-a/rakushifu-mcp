import { describe, expect, it } from 'vitest';
import { ConfigError, loadAuthToken, loadSalaryDefaults, resolveCredentials } from './config.js';

const TOKEN = 'x'.repeat(32);
const envCredentials = {
  RAKUSHIFU_EMPLOYEE_CODE: '12345',
  RAKUSHIFU_PASSWORD: 'env-pw',
};

describe('loadAuthToken', () => {
  it('トークンを読む', () => {
    expect(loadAuthToken({ MCP_AUTH_TOKEN: TOKEN })).toBe(TOKEN);
  });

  it('無い、または短すぎるトークンは拒否する', () => {
    expect(() => loadAuthToken({})).toThrow('MCP_AUTH_TOKEN');
    expect(() => loadAuthToken({ MCP_AUTH_TOKEN: 'short' })).toThrow(ConfigError);
  });
});

describe('resolveCredentials', () => {
  it('ヘッダーの値を環境変数より優先する', () => {
    expect(resolveCredentials({ employeeCode: '99999', password: 'header-pw' }, envCredentials)).toEqual({
      employeeCode: '99999',
      password: 'header-pw',
    });
  });

  it('ヘッダーが無ければ環境変数を使う', () => {
    expect(resolveCredentials({}, envCredentials)).toEqual({ employeeCode: '12345', password: 'env-pw' });
  });

  it('ヘッダーが片方だけなら環境変数に頼らず失敗する', () => {
    expect(() => resolveCredentials({ employeeCode: '99999' }, envCredentials)).toThrow('両方');
    expect(() => resolveCredentials({ password: 'header-pw' }, envCredentials)).toThrow(ConfigError);
  });

  it('どちらにも無ければ設定方法を示して失敗する', () => {
    expect(() => resolveCredentials({}, {})).toThrow('X-Rakushifu-Employee-Code');
    expect(() => resolveCredentials({}, { RAKUSHIFU_EMPLOYEE_CODE: '12345' })).toThrow(ConfigError);
  });
});

describe('loadSalaryDefaults', () => {
  it('省略時は既定値を使う', () => {
    expect(loadSalaryDefaults({})).toEqual({ hourlyRate: 1200, transportCost: 0 });
  });

  it('時給と交通費を数値として読む', () => {
    expect(loadSalaryDefaults({ HOURLY_RATE: '1350', TRANSPORT_COST: '420' })).toEqual({
      hourlyRate: 1350,
      transportCost: 420,
    });
  });

  it('数値でない時給は拒否し、値をメッセージに含めない', () => {
    expect(() => loadSalaryDefaults({ HOURLY_RATE: 'abc' })).toThrow(/HOURLY_RATE/);
    expect(() => loadSalaryDefaults({ HOURLY_RATE: 'abc' })).not.toThrow(/abc/);
    expect(() => loadSalaryDefaults({ TRANSPORT_COST: '-1' })).toThrow(ConfigError);
  });
});
