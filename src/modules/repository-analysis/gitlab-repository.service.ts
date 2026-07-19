import { env } from '@/config/env';
import { AppError } from '@/shared/http/app-error';

export interface ParsedGitLabRepositoryUrl {
  repositoryUrl: string;
  baseUrl: string;
  host: string;
  projectPath: string;
}

export interface GitLabProjectMetadata {
  id: number;
  name: string;
  path_with_namespace: string;
  default_branch?: string | null;
  web_url: string;
  last_activity_at?: string;
}

export interface GitLabCommitMetadata {
  id: string;
  short_id: string;
  title: string;
  authored_date?: string;
  committed_date?: string;
  web_url?: string;
}

export interface GitLabTreeEntry {
  id: string;
  name: string;
  type: 'tree' | 'blob' | 'commit';
  path: string;
  mode: string;
}

const normalizeBaseUrl = (value: string): string => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');

  // Accept both https://gitlab.example.com and the commonly misconfigured
  // https://gitlab.example.com/api/v4 form. API paths are appended centrally.
  return trimmed.replace(/\/api\/v4$/i, '');
};

const getConfiguredGitLabUrl = (): URL | null => {
  if (!env.gitlabBaseUrl) return null;

  try {
    return new URL(normalizeBaseUrl(env.gitlabBaseUrl));
  } catch {
    throw new AppError(
      'GITLAB_BASE_URL معتبر نیست.',
      503,
      'INVALID_GITLAB_BASE_URL_CONFIGURATION',
    );
  }
};

const getBaseUrlForHost = (host: string, fallbackBaseUrl: string): string => {
  const configuredUrl = getConfiguredGitLabUrl();

  if (configuredUrl && configuredUrl.hostname.toLowerCase() === host.toLowerCase()) {
    return normalizeBaseUrl(configuredUrl.toString());
  }

  return normalizeBaseUrl(fallbackBaseUrl);
};

const stripConfiguredBasePath = (host: string, pathname: string): string => {
  const configuredUrl = getConfiguredGitLabUrl();
  let normalizedPath = pathname;

  if (configuredUrl && configuredUrl.hostname.toLowerCase() === host.toLowerCase()) {
    const basePath = configuredUrl.pathname.replace(/^\/+|\/+$/g, '');

    if (basePath) {
      const pathWithoutSlashes = normalizedPath.replace(/^\/+/, '');
      if (pathWithoutSlashes === basePath) return '';
      if (pathWithoutSlashes.startsWith(`${basePath}/`)) {
        normalizedPath = pathWithoutSlashes.slice(basePath.length + 1);
      }
    }
  }

  return normalizedPath;
};

const stripGitLabUiSuffix = (pathname: string): string => {
  const normalized = pathname.replace(/\\/g, '/');
  const uiSeparatorIndex = normalized.indexOf('/-/');

  if (uiSeparatorIndex >= 0) {
    return normalized.slice(0, uiSeparatorIndex);
  }

  return normalized;
};

const normalizeProjectPath = (pathname: string): string =>
  stripGitLabUiSuffix(pathname)
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .trim();

const parseSshCloneUrl = (value: string): ParsedGitLabRepositoryUrl | null => {
  const scpStyleMatch = value.match(/^git@([^:]+):(.+)$/i);

  if (scpStyleMatch) {
    const host = scpStyleMatch[1].trim().toLowerCase();
    const projectPath = normalizeProjectPath(scpStyleMatch[2]);

    if (!host || !projectPath || !projectPath.includes('/')) return null;

    return {
      repositoryUrl: value,
      baseUrl: getBaseUrlForHost(host, `https://${host}`),
      host,
      projectPath,
    };
  }

  if (!/^ssh:\/\//i.test(value)) return null;

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const projectPath = normalizeProjectPath(
      stripConfiguredBasePath(host, decodeURIComponent(url.pathname)),
    );

    if (!host || !projectPath || !projectPath.includes('/')) return null;

    return {
      repositoryUrl: value,
      baseUrl: getBaseUrlForHost(host, `https://${url.host}`),
      host,
      projectPath,
    };
  } catch {
    return null;
  }
};

const getAllowedHosts = (): Set<string> => {
  const configured = env.repositoryAnalysisAllowedGitlabHosts
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (env.gitlabBaseUrl) {
    try {
      configured.push(
        new URL(normalizeBaseUrl(env.gitlabBaseUrl)).hostname.toLowerCase(),
      );
    } catch {
      // Configuration validation is handled when a repository is used.
    }
  }

  return new Set(configured);
};

const assertAllowedHost = (host: string): void => {
  const normalizedHost = host.toLowerCase();
  const allowedHosts = getAllowedHosts();

  if (allowedHosts.size > 0 && !allowedHosts.has(normalizedHost)) {
    throw new AppError(
      'دامنه GitLab این مخزن در فهرست دامنه‌های مجاز نیست.',
      400,
      'GITLAB_HOST_NOT_ALLOWED',
      { host: normalizedHost },
    );
  }

  if (allowedHosts.size === 0 && env.nodeEnv === 'production') {
    throw new AppError(
      'برای استفاده از تحلیل مخزن در محیط production باید دامنه‌های مجاز GitLab تنظیم شوند.',
      503,
      'GITLAB_ALLOWED_HOSTS_NOT_CONFIGURED',
    );
  }

  const configuredUrl = getConfiguredGitLabUrl();
  if (
    env.gitlabAccessToken &&
    configuredUrl &&
    configuredUrl.hostname.toLowerCase() !== normalizedHost
  ) {
    throw new AppError(
      'توکن GitLab فقط برای دامنه تنظیم‌شده در GITLAB_BASE_URL قابل استفاده است.',
      400,
      'GITLAB_TOKEN_HOST_MISMATCH',
    );
  }
};

export const parseGitLabRepositoryUrl = (
  rawUrl: string,
): ParsedGitLabRepositoryUrl => {
  const value = String(rawUrl || '').trim();

  if (!value) {
    throw new AppError(
      'آدرس مخزن GitLab الزامی است.',
      400,
      'REPOSITORY_URL_REQUIRED',
    );
  }

  const sshResult = parseSshCloneUrl(value);

  if (sshResult) {
    assertAllowedHost(sshResult.host);
    return sshResult;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      'آدرس مخزن GitLab معتبر نیست.',
      400,
      'INVALID_REPOSITORY_URL',
    );
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new AppError(
      'فقط آدرس‌های HTTP، HTTPS یا SSH مخزن GitLab پشتیبانی می‌شوند.',
      400,
      'UNSUPPORTED_REPOSITORY_PROTOCOL',
    );
  }

  if (
    url.protocol === 'http:' &&
    !env.repositoryAnalysisAllowInsecureHttp &&
    !['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())
  ) {
    throw new AppError(
      'برای محافظت از توکن GitLab باید از HTTPS استفاده شود.',
      400,
      'INSECURE_GITLAB_URL',
    );
  }

  const host = url.hostname.toLowerCase();
  assertAllowedHost(host);

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    throw new AppError(
      'مسیر مخزن GitLab دارای encoding نامعتبر است.',
      400,
      'INVALID_GITLAB_PROJECT_PATH_ENCODING',
    );
  }

  const projectPath = normalizeProjectPath(
    stripConfiguredBasePath(host, decodedPath),
  );

  if (!projectPath || !projectPath.includes('/')) {
    throw new AppError(
      'مسیر مخزن باید شامل namespace و نام پروژه باشد.',
      400,
      'INVALID_GITLAB_PROJECT_PATH',
    );
  }

  return {
    repositoryUrl: value,
    baseUrl: getBaseUrlForHost(host, `${url.protocol}//${url.host}`),
    host,
    projectPath,
  };
};

const withTimeout = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    env.repositoryAnalysisGitlabTimeoutMs,
  );

  try {
    return await operation(controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError(
        'ارتباط با GitLab بیش از زمان مجاز طول کشید.',
        504,
        'GITLAB_REQUEST_TIMEOUT',
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const buildHeaders = (includeToken = true): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (includeToken && env.gitlabAccessToken) {
    headers['PRIVATE-TOKEN'] = env.gitlabAccessToken;
  }

  return headers;
};

const readGitLabError = async (response: Response): Promise<string> => {
  const contentType = response.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/json')) {
      const body = (await response.json()) as {
        message?: string | Record<string, string[]>;
        error?: string;
      };

      if (typeof body.message === 'string') return body.message;
      if (body.error) return body.error;
      if (body.message && typeof body.message === 'object') {
        return Object.entries(body.message)
          .map(([key, messages]) => `${key}: ${messages.join(', ')}`)
          .join('; ');
      }
    }

    const text = await response.text();
    if (text) return text;
  } catch {
    // Use the status fallback below.
  }

  return `GitLab request failed with status ${response.status}.`;
};

const fetchWithPublicFallback = async (
  targetUrl: string,
  signal: AbortSignal,
): Promise<{ response: Response; anonymousFallbackUsed: boolean }> => {
  let response = await fetch(targetUrl, {
    method: 'GET',
    headers: buildHeaders(true),
    signal,
  });

  let anonymousFallbackUsed = false;

  // A configured token can be expired, scoped to another project, or belong to
  // a user who cannot see this project. GitLab may return 404 in that case.
  // Public repositories must still work, so retry once without credentials.
  if (
    env.gitlabAccessToken &&
    [401, 403, 404].includes(response.status)
  ) {
    const anonymousResponse = await fetch(targetUrl, {
      method: 'GET',
      headers: buildHeaders(false),
      signal,
    });

    anonymousFallbackUsed = true;
    response = anonymousResponse;
  }

  return { response, anonymousFallbackUsed };
};

const gitlabRequest = async <T>(
  baseUrl: string,
  path: string,
): Promise<{ data: T; headers: Headers }> => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const targetUrl = `${normalizedBaseUrl}/api/v4${path}`;

  return withTimeout(async (signal) => {
    const { response, anonymousFallbackUsed } = await fetchWithPublicFallback(
      targetUrl,
      signal,
    );

    if (!response.ok) {
      const message = await readGitLabError(response);

      throw new AppError(
        message,
        response.status === 401 || response.status === 403
          ? 502
          : response.status === 404
            ? 404
            : 502,
        response.status === 404
          ? 'GITLAB_RESOURCE_NOT_FOUND'
          : 'GITLAB_REQUEST_FAILED',
        {
          gitlabStatus: response.status,
          baseUrl: normalizedBaseUrl,
          path,
          anonymousFallbackUsed,
        },
      );
    }

    const data = (await response.json()) as T;
    return { data, headers: response.headers };
  });
};

const rethrowNotFound = (
  error: unknown,
  message: string,
  code: string,
  details: Record<string, unknown>,
): never => {
  if (error instanceof AppError && error.code === 'GITLAB_RESOURCE_NOT_FOUND') {
    throw new AppError(message, 404, code, {
      ...details,
      upstream: error.details,
    });
  }

  throw error;
};

export const fetchGitLabProjectMetadata = async (
  baseUrl: string,
  projectPath: string,
): Promise<GitLabProjectMetadata> => {
  const projectId = encodeURIComponent(projectPath);

  try {
    const { data } = await gitlabRequest<GitLabProjectMetadata>(
      baseUrl,
      `/projects/${projectId}`,
    );

    return data;
  } catch (error) {
    return rethrowNotFound(
      error,
      'پروژه GitLab پیدا نشد. آدرس مخزن، namespace و تنظیم GITLAB_BASE_URL را بررسی کنید.',
      'GITLAB_PROJECT_NOT_FOUND',
      { baseUrl: normalizeBaseUrl(baseUrl), projectPath },
    );
  }
};

export const fetchGitLabCommit = async (
  baseUrl: string,
  projectPathOrId: string,
  ref: string,
): Promise<GitLabCommitMetadata> => {
  const projectId = encodeURIComponent(projectPathOrId);
  const encodedRef = encodeURIComponent(ref);

  try {
    const { data } = await gitlabRequest<GitLabCommitMetadata>(
      baseUrl,
      `/projects/${projectId}/repository/commits/${encodedRef}`,
    );

    return data;
  } catch (error) {
    return rethrowNotFound(
      error,
      `شاخه، tag یا commit با مقدار «${ref}» در مخزن GitLab پیدا نشد.`,
      'GITLAB_REF_NOT_FOUND',
      { projectPathOrId, ref },
    );
  }
};

export const listGitLabRepositoryTree = async (
  baseUrl: string,
  projectPathOrId: string,
  ref: string,
): Promise<{ entries: GitLabTreeEntry[]; truncated: boolean }> => {
  const projectId = encodeURIComponent(projectPathOrId);
  const entries: GitLabTreeEntry[] = [];
  let page = 1;
  let truncated = false;

  try {
    while (entries.length < env.repositoryAnalysisMaxFiles) {
      const query = new URLSearchParams({
        ref,
        recursive: 'true',
        per_page: '100',
        page: String(page),
      });
      const { data, headers } = await gitlabRequest<GitLabTreeEntry[]>(
        baseUrl,
        `/projects/${projectId}/repository/tree?${query.toString()}`,
      );

      const remainingCapacity = Math.max(
        0,
        env.repositoryAnalysisMaxFiles - entries.length,
      );
      entries.push(...data.slice(0, remainingCapacity));

      if (data.length > remainingCapacity) {
        truncated = true;
        break;
      }

      if (entries.length >= env.repositoryAnalysisMaxFiles) {
        truncated = Boolean(headers.get('x-next-page'));
        break;
      }

      const nextPage = headers.get('x-next-page');

      if (!nextPage) break;

      page = Number(nextPage);

      if (!Number.isFinite(page) || page <= 0) break;
    }
  } catch (error) {
    return rethrowNotFound(
      error,
      'ساختار فایل‌های مخزن GitLab پیدا نشد. ممکن است مخزن خالی باشد یا commit انتخاب‌شده قابل دسترس نباشد.',
      'GITLAB_REPOSITORY_TREE_NOT_FOUND',
      { projectPathOrId, ref },
    );
  }

  return { entries, truncated };
};

export const readGitLabRepositoryFile = async (
  baseUrl: string,
  projectPathOrId: string,
  ref: string,
  filePath: string,
): Promise<string> => {
  const projectId = encodeURIComponent(projectPathOrId);
  const encodedPath = encodeURIComponent(filePath);
  const query = new URLSearchParams({ ref });
  const targetUrl = `${normalizeBaseUrl(baseUrl)}/api/v4/projects/${projectId}/repository/files/${encodedPath}/raw?${query.toString()}`;

  return withTimeout(async (signal) => {
    const { response, anonymousFallbackUsed } = await fetchWithPublicFallback(
      targetUrl,
      signal,
    );

    if (!response.ok) {
      const message = await readGitLabError(response);
      throw new AppError(
        message,
        response.status === 404 ? 404 : 502,
        response.status === 404
          ? 'GITLAB_FILE_NOT_FOUND'
          : 'GITLAB_FILE_READ_FAILED',
        {
          filePath,
          gitlabStatus: response.status,
          anonymousFallbackUsed,
        },
      );
    }

    const contentLength = Number(response.headers.get('content-length') || 0);

    if (
      contentLength > 0 &&
      contentLength > env.repositoryAnalysisMaxFileBytes
    ) {
      throw new AppError(
        'حجم فایل برای تحلیل ایستا بیشتر از حد مجاز است.',
        413,
        'REPOSITORY_FILE_TOO_LARGE',
        { filePath, contentLength },
      );
    }

    const text = await response.text();

    if (Buffer.byteLength(text, 'utf8') > env.repositoryAnalysisMaxFileBytes) {
      throw new AppError(
        'حجم فایل برای تحلیل ایستا بیشتر از حد مجاز است.',
        413,
        'REPOSITORY_FILE_TOO_LARGE',
        { filePath },
      );
    }

    return text;
  });
};
