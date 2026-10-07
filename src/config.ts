const DEFAULT_HOURLY_RATE = 1200;
const DEFAULT_TRANSPORT_COST = 0;
const MIN_AUTH_TOKEN_LENGTH = 32;

export interface Config {
  employeeCode: string;
  password: string;
  authToken: string;
  hourlyRate: number;
  transportCost: number;
}

/**
 * 環境変数の設定ミス。メッセージには変数名だけを載せ、値は含めない。
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new ConfigError(`環境変数 ${name} が設定されていません`);
  }
  return value;
}

function optionalAmount(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new ConfigError(`環境変数 ${name} は 0 以上の数値で指定してください`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authToken = required(env, 'MCP_AUTH_TOKEN');
  if (authToken.length < MIN_AUTH_TOKEN_LENGTH) {
    throw new ConfigError(`環境変数 MCP_AUTH_TOKEN は ${MIN_AUTH_TOKEN_LENGTH} 文字以上にしてください`);
  }

  return {
    employeeCode: required(env, 'RAKUSHIFU_EMPLOYEE_CODE'),
    password: required(env, 'RAKUSHIFU_PASSWORD'),
    authToken,
    hourlyRate: optionalAmount(env, 'HOURLY_RATE', DEFAULT_HOURLY_RATE),
    transportCost: optionalAmount(env, 'TRANSPORT_COST', DEFAULT_TRANSPORT_COST),
  };
}
