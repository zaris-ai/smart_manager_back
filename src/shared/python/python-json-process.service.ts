import { spawn } from 'child_process';
import { PythonProcessError } from './python-process.error';
import type {
  PythonJsonProcessOptions,
  PythonProcessEvent,
} from './python-process.types';

const parseJsonLine = (line: string): PythonProcessEvent | null => {
  if (!line.trim()) return null;
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === 'object'
      ? (value as PythonProcessEvent)
      : null;
  } catch {
    return null;
  }
};

export const runPythonJsonProcess = async <TResult>(
  options: PythonJsonProcessOptions<TResult>,
): Promise<TResult> =>
  new Promise<TResult>((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: options.env,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let stderrBuffer = '';
    let latestErrorEvent: PythonProcessEvent | undefined;
    let settled = false;
    let eventChain = Promise.resolve();

    const rejectOnce = (error: PythonProcessError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const dispatchEvent = (event: PythonProcessEvent): void => {
      if (event.type === 'error' || event.type === 'fatal') {
        latestErrorEvent = event;
      }
      if (!options.onEvent) return;
      eventChain = eventChain
        .then(() => options.onEvent?.(event))
        .then(() => undefined)
        .catch((error) => {
          console.error('Unable to process Python event:', error);
        });
    };

    const consumeStderrLine = (line: string): void => {
      const event = parseJsonLine(line);
      if (event) dispatchEvent(event);
    };

    const terminate = (): void => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    };

    const timer = setTimeout(() => {
      terminate();
      rejectOnce(
        new PythonProcessError({
          code: 'PYTHON_PROCESS_TIMEOUT',
          message: 'Python process exceeded its configured timeout.',
        }),
      );
    }, Math.max(1_000, options.timeoutMs));

    child.on('error', (error) => {
      rejectOnce(
        new PythonProcessError({
          code: 'PYTHON_PROCESS_START_FAILED',
          message: `Unable to start Python process: ${error.message}`,
          cause: error,
        }),
      );
    });

    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout, 'utf8') > options.maxOutputBytes) {
        terminate();
        rejectOnce(
          new PythonProcessError({
            code: 'PYTHON_PROCESS_OUTPUT_TOO_LARGE',
            message: 'Python stdout exceeded the configured output limit.',
          }),
        );
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      stderrBuffer += text;

      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() || '';
      lines.forEach(consumeStderrLine);

      if (Buffer.byteLength(stderr, 'utf8') > options.maxOutputBytes) {
        stderr = stderr.slice(-options.maxOutputBytes);
      }
    });

    child.on('close', async (exitCode, signal) => {
      if (settled) return;
      clearTimeout(timer);
      if (stderrBuffer) consumeStderrLine(stderrBuffer);
      await eventChain;

      const diagnostics = {
        exitCode,
        signal,
        stderrTail: stderr.slice(-12_000),
      };

      if (exitCode !== 0) {
        rejectOnce(
          new PythonProcessError({
            code:
              typeof latestErrorEvent?.code === 'string'
                ? latestErrorEvent.code
                : 'PYTHON_PROCESS_FAILED',
            message:
              typeof latestErrorEvent?.message === 'string'
                ? latestErrorEvent.message
                : 'Python process failed.',
            event: latestErrorEvent,
            diagnostics,
          }),
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as unknown;
        const result = options.validateResult
          ? options.validateResult(parsed)
          : (parsed as TResult);
        settled = true;
        resolve(result);
      } catch (error) {
        rejectOnce(
          new PythonProcessError({
            code: 'PYTHON_PROCESS_INVALID_OUTPUT',
            message: `Python stdout is not a valid result: ${
              error instanceof Error ? error.message : String(error)
            }`,
            diagnostics,
            cause: error,
          }),
        );
      }
    });

    child.stdin.on('error', (error) => {
      rejectOnce(
        new PythonProcessError({
          code: 'PYTHON_PROCESS_STDIN_FAILED',
          message: `Unable to write Python stdin: ${error.message}`,
          cause: error,
        }),
      );
    });

    child.stdin.end(JSON.stringify(options.input), 'utf8');
  });
