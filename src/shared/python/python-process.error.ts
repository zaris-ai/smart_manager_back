import type {
  PythonProcessDiagnostics,
  PythonProcessEvent,
} from './python-process.types';

export class PythonProcessError extends Error {
  readonly code: string;
  readonly event?: PythonProcessEvent;
  readonly diagnostics?: PythonProcessDiagnostics;

  constructor(input: {
    code: string;
    message: string;
    event?: PythonProcessEvent;
    diagnostics?: PythonProcessDiagnostics;
    cause?: unknown;
  }) {
    super(input.message);
    if (input.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = input.cause;
    }
    this.name = 'PythonProcessError';
    this.code = input.code;
    this.event = input.event;
    this.diagnostics = input.diagnostics;
  }
}
