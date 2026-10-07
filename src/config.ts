const DEFAULT_HOURLY_RATE = 1200;
const DEFAULT_TRANSPORT_COST = 0;
const MIN_AUTH_TOKEN_LENGTH = 32;

export interface Credentials {
  employeeCode: string;
  password: string;
}

export interface SalaryDefaults {
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

/**
 * エンドポイントのトークンだけを読む。認証前に他の設定の不備を見せないために分けている。
 */
export function loadAuthToken(env: NodeJS.ProcessEnv = process.env): string {
  const authToken = required(env, 'MCP_AUTH_TOKEN');
  if (authToken.length < MIN_AUTH_TOKEN_LENGTH) {
    throw new ConfigError(`環境変数 MCP_AUTH_TOKEN は ${MIN_AUTH_TOKEN_LENGTH} 文字以上にしてください`);
  }
  return authToken;
}

/**
 * らくしふの認証情報を決める。リクエストヘッダーで渡されていればそれを使い、無ければ環境変数を使う。
 */
export function resolveCredentials(
  fromHeaders: Partial<Credentials>,
  env: NodeJS.ProcessEnv = process.env
): Credentials {
  const { employeeCode, password } = fromHeaders;
  if (employeeCode || password) {
    if (!employeeCode || !password) {
      throw new ConfigError('ヘッダー X-Rakushifu-Employee-Code と X-Rakushifu-Password は両方設定してください');
    }
    return { employeeCode, password };
  }

  if (!env.RAKUSHIFU_EMPLOYEE_CODE || !env.RAKUSHIFU_PASSWORD) {
    throw new ConfigError(
      'らくしふの従業員コードとパスワードが設定されていません。ヘッダー X-Rakushifu-Employee-Code と X-Rakushifu-Password か、環境変数 RAKUSHIFU_EMPLOYEE_CODE と RAKUSHIFU_PASSWORD で設定してください'
    );
  }
  return { employeeCode: env.RAKUSHIFU_EMPLOYEE_CODE, password: env.RAKUSHIFU_PASSWORD };
}

export function loadSalaryDefaults(env: NodeJS.ProcessEnv = process.env): SalaryDefaults {
  return {
    hourlyRate: optionalAmount(env, 'HOURLY_RATE', DEFAULT_HOURLY_RATE),
    transportCost: optionalAmount(env, 'TRANSPORT_COST', DEFAULT_TRANSPORT_COST),
  };
}
