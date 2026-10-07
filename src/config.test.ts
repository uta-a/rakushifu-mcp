import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const TOKEN = 'x'.repeat(32);
const base = {
  RAKUSHIFU_EMPLOYEE_CODE: '12345',
  RAKUSHIFU_PASSWORD: 'pw',
  MCP_AUTH_TOKEN: TOKEN,
};

describe('loadConfig', () => {
  it('必須の値を読み、時給と交通費は省略時に既定値を使う', () => {
    expect(loadConfig(base)).toEqual({
      employeeCode: '12345',
      password: 'pw',
      authToken: TOKEN,
      hourlyRate: 1200,
      transportCost: 0,
    });
  });

  it('時給と交通費を数値として読む', () => {
    const config = loadConfig({ ...base, HOURLY_RATE: '1350', TRANSPORT_COST: '420' });
    expect(config.hourlyRate).toBe(1350);
    expect(config.transportCost).toBe(420);
  });

  it('必須の値が無ければ変数名を示して失敗する', () => {
    expect(() => loadConfig({ ...base, RAKUSHIFU_PASSWORD: '' })).toThrow('RAKUSHIFU_PASSWORD');
  });

  it('短すぎるトークンは拒否する', () => {
    expect(() => loadConfig({ ...base, MCP_AUTH_TOKEN: 'short' })).toThrow(ConfigError);
  });

  it('数値でない時給は拒否し、値をメッセージに含めない', () => {
    expect(() => loadConfig({ ...base, HOURLY_RATE: 'abc' })).toThrow(/HOURLY_RATE/);
    expect(() => loadConfig({ ...base, HOURLY_RATE: 'abc' })).not.toThrow(/abc/);
    expect(() => loadConfig({ ...base, TRANSPORT_COST: '-1' })).toThrow(ConfigError);
  });
});
