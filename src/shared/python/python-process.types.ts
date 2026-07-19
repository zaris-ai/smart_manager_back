export interface PythonProcessEvent {
  type?: string;
  code?: string;
  message?: string;
  details?: unknown;
  [key: string]: unknown;
}

export interface PythonProcessDiagnostics {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
}

export interface PythonJsonProcessOptions<TResult> {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  input: unknown;
  timeoutMs: number;
  maxOutputBytes: number;
  onEvent?: (event: PythonProcessEvent) => Promise<void> | void;
  validateResult?: (value: unknown) => TResult;
}
