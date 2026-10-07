/**
 * ツールの入力の誤り。メッセージはそのままツールの結果に載せる。
 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}
