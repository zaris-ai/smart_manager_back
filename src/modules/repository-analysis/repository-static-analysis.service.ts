import path from 'path';
import { env } from '@/config/env';
import {
  GitLabTreeEntry,
  readGitLabRepositoryFile,
} from './gitlab-repository.service';
import {
  RepositoryArchitectureResult,
  RepositoryInventory,
  RepositoryLanguageRecord,
  RepositoryPackageRecord,
} from './repository-analysis.model';

export interface RepositoryFileContent {
  path: string;
  content: string;
  purpose: 'manifest' | 'source';
}

export interface DeterministicRepositoryAnalysis {
  inventory: RepositoryInventory;
  files: RepositoryFileContent[];
  packages: RepositoryPackageRecord[];
  frameworks: string[];
  architecture: RepositoryArchitectureResult;
  executiveReport: string;
  technicalReport: string;
  warnings: string[];
}

const IGNORED_PATH_SEGMENTS = new Set([
  '.git',
  '.idea',
  '.vscode',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'bin',
  'obj',
  'Pods',
  'DerivedData',
]);

const SENSITIVE_FILE_PATTERNS = [
  /(^|\/)\.env($|\.)/i,
  /(^|\/)(secret|secrets|credentials)(\.|\/|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /id_rsa/i,
  /service[-_.]?account/i,
];

const MANIFEST_MATCHERS: RegExp[] = [
  /(^|\/)package\.json$/i,
  /(^|\/)package-lock\.json$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)requirements(?:-[^/]+)?\.txt$/i,
  /(^|\/)pyproject\.toml$/i,
  /(^|\/)Pipfile$/i,
  /(^|\/)poetry\.lock$/i,
  /\.csproj$/i,
  /\.sln$/i,
  /(^|\/)Directory\.Packages\.props$/i,
  /(^|\/)pom\.xml$/i,
  /(^|\/)build\.gradle(?:\.kts)?$/i,
  /(^|\/)composer\.json$/i,
  /(^|\/)go\.mod$/i,
  /(^|\/)Cargo\.toml$/i,
  /(^|\/)pubspec\.yaml$/i,
  /(^|\/)Dockerfile(?:\.[^/]+)?$/i,
  /(^|\/)(docker-compose|compose)(?:\.[^/]+)?\.ya?ml$/i,
  /(^|\/)\.gitlab-ci\.ya?ml$/i,
  /(^|\/)tsconfig(?:\.[^/]+)?\.json$/i,
];

const READABLE_MANIFEST_MATCHERS: RegExp[] = [
  /(^|\/)package\.json$/i,
  /(^|\/)requirements(?:-[^/]+)?\.txt$/i,
  /(^|\/)pyproject\.toml$/i,
  /(^|\/)Pipfile$/i,
  /\.csproj$/i,
  /(^|\/)Directory\.Packages\.props$/i,
  /(^|\/)pom\.xml$/i,
  /(^|\/)build\.gradle(?:\.kts)?$/i,
  /(^|\/)composer\.json$/i,
  /(^|\/)go\.mod$/i,
  /(^|\/)Cargo\.toml$/i,
  /(^|\/)pubspec\.yaml$/i,
  /(^|\/)Dockerfile(?:\.[^/]+)?$/i,
  /(^|\/)(docker-compose|compose)(?:\.[^/]+)?\.ya?ml$/i,
  /(^|\/)\.gitlab-ci\.ya?ml$/i,
  /(^|\/)tsconfig(?:\.[^/]+)?\.json$/i,
];

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.cs',
  '.java',
  '.kt',
  '.kts',
  '.php',
  '.go',
  '.rs',
  '.rb',
  '.swift',
  '.dart',
  '.vue',
  '.svelte',
  '.sql',
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript React',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript React',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.cs': 'C#',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.php': 'PHP',
  '.go': 'Go',
  '.rs': 'Rust',
  '.rb': 'Ruby',
  '.swift': 'Swift',
  '.dart': 'Dart',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.sql': 'SQL',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'Sass',
  '.less': 'Less',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.xml': 'XML',
  '.md': 'Markdown',
  '.sh': 'Shell',
};

const ENTRY_FILE_PATTERNS: RegExp[] = [
  /(^|\/)src\/(main|index|app|server)\.[^/]+$/i,
  /(^|\/)(main|index|app|server)\.[^/]+$/i,
  /(^|\/)manage\.py$/i,
  /(^|\/)Program\.cs$/i,
  /(^|\/)Startup\.cs$/i,
  /(^|\/)settings\.py$/i,
  /(^|\/)urls\.py$/i,
  /(^|\/)routes?\.(ts|js|py|php)$/i,
  /(^|\/)modules\/index\.(ts|js)$/i,
];

const ARCHITECTURE_FILE_PATTERNS: RegExp[] = [
  /(^|\/)(routes?|controllers?|services?|repositories?|models?|entities?|use-cases?|application|domain|infrastructure|presentation|modules|features)(\/|$)/i,
  /(^|\/)(Dockerfile|docker-compose|compose|\.gitlab-ci)/i,
];

const normalizePath = (value: string): string => value.replace(/\\/g, '/');

const isIgnoredPath = (filePath: string): boolean => {
  const segments = normalizePath(filePath).split('/');
  return segments.some((segment) => IGNORED_PATH_SEGMENTS.has(segment));
};

const isSensitivePath = (filePath: string): boolean =>
  SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(filePath));

const isManifestPath = (filePath: string): boolean =>
  MANIFEST_MATCHERS.some((pattern) => pattern.test(filePath));

const isReadableManifestPath = (filePath: string): boolean =>
  READABLE_MANIFEST_MATCHERS.some((pattern) => pattern.test(filePath));

const isSourcePath = (filePath: string): boolean =>
  SOURCE_EXTENSIONS.has(path.posix.extname(normalizePath(filePath)).toLowerCase());

const getTopLevelName = (filePath: string): string =>
  normalizePath(filePath).split('/')[0] || '';

const buildLanguages = (files: GitLabTreeEntry[]): RepositoryLanguageRecord[] => {
  const accumulator = new Map<
    string,
    { fileCount: number }
  >();

  for (const file of files) {
    const extension = path.posix.extname(normalizePath(file.path)).toLowerCase();
    const language = LANGUAGE_BY_EXTENSION[extension];

    if (!language) continue;

    const current = accumulator.get(language) || {
      fileCount: 0,
    };

    current.fileCount += 1;
    accumulator.set(language, current);
  }

  return [...accumulator.entries()]
    .map(([name, values]) => ({ name, ...values }))
    .sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name));
};

const uniqueSorted = (values: string[]): string[] =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

const scoreSourcePath = (filePath: string): number => {
  let score = 0;
  const normalized = normalizePath(filePath);
  const depth = normalized.split('/').length;

  if (ENTRY_FILE_PATTERNS.some((pattern) => pattern.test(normalized))) score += 100;
  if (ARCHITECTURE_FILE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    score += 40;
  }
  if (/index\.(ts|js|py)$/i.test(normalized)) score += 20;
  if (/README\.md$/i.test(normalized)) score += 15;
  score += Math.max(0, 12 - depth);

  return score;
};

const sourceGroupKey = (filePath: string): string => {
  const segments = normalizePath(filePath).split('/').filter(Boolean);
  if (segments.length <= 1) return 'root';
  if (segments[0] === 'src' && segments.length >= 3) {
    return segments.slice(0, 3).join('/');
  }
  return segments.slice(0, Math.min(2, segments.length)).join('/');
};

const selectDiverseSourcePaths = (
  candidates: GitLabTreeEntry[],
  capacity: number,
): string[] => {
  if (capacity <= 0) return [];

  const sorted = [...candidates].sort((a, b) => {
    const scoreDifference = scoreSourcePath(b.path) - scoreSourcePath(a.path);
    if (scoreDifference !== 0) return scoreDifference;
    return a.path.localeCompare(b.path);
  });
  const selected: string[] = [];
  const selectedSet = new Set<string>();

  const add = (filePath: string): void => {
    if (selected.length >= capacity || selectedSet.has(filePath)) return;
    selectedSet.add(filePath);
    selected.push(filePath);
  };

  // Always preserve entry points and architecture roots first.
  sorted
    .filter((entry) => ENTRY_FILE_PATTERNS.some((pattern) => pattern.test(entry.path)))
    .forEach((entry) => add(entry.path));

  const groups = new Map<string, GitLabTreeEntry[]>();
  for (const entry of sorted) {
    const key = sourceGroupKey(entry.path);
    const values = groups.get(key) || [];
    values.push(entry);
    groups.set(key, values);
  }

  const groupQueues = [...groups.entries()]
    .sort((a, b) => {
      const aScore = Math.max(...a[1].map((entry) => scoreSourcePath(entry.path)));
      const bScore = Math.max(...b[1].map((entry) => scoreSourcePath(entry.path)));
      return bScore - aScore || a[0].localeCompare(b[0]);
    })
    .map(([, entries]) => [...entries]);

  let addedInRound = true;
  while (selected.length < capacity && addedInRound) {
    addedInRound = false;
    for (const queue of groupQueues) {
      const next = queue.find((entry) => !selectedSet.has(entry.path));
      if (!next) continue;
      add(next.path);
      addedInRound = true;
      if (selected.length >= capacity) break;
    }
  }

  // Fill any remaining capacity by global score.
  sorted.forEach((entry) => add(entry.path));
  return selected;
};

const selectFiles = (
  files: GitLabTreeEntry[],
): { detectedManifests: string[]; manifests: string[]; sources: string[] } => {
  const detectedManifests = files
    .filter((entry) => isManifestPath(entry.path) && !isSensitivePath(entry.path))
    .map((entry) => entry.path)
    .sort((a, b) => a.localeCompare(b));
  const manifestCapacity = Math.max(
    1,
    Math.min(30, env.repositoryAnalysisMaxSelectedFiles - 12),
  );
  const manifests = detectedManifests
    .filter((filePath) => isReadableManifestPath(filePath))
    .sort((a, b) => {
      const depthDifference = a.split('/').length - b.split('/').length;
      if (depthDifference !== 0) return depthDifference;
      return a.localeCompare(b);
    })
    .slice(0, manifestCapacity);

  const remainingCapacity = Math.max(
    0,
    env.repositoryAnalysisMaxSelectedFiles - manifests.length,
  );

  const sourceCandidates = files.filter(
    (entry) =>
      (isSourcePath(entry.path) || /README\.md$/i.test(entry.path)) &&
      !isSensitivePath(entry.path),
  );
  const sources = selectDiverseSourcePaths(sourceCandidates, remainingCapacity);

  return { detectedManifests, manifests, sources };
};

const redactSensitiveValues = (content: string): string => {
  const patterns: RegExp[] = [
    /((?:api[_-]?key|token|secret|password|passwd|private[_-]?key)\s*[:=]\s*)["']?[^\s,"']+["']?/gi,
    /(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi,
    /(-----BEGIN [A-Z ]+ PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]+ PRIVATE KEY-----)/g,
  ];

  return patterns.reduce(
    (current, pattern) => current.replace(pattern, '$1[REDACTED]'),
    content,
  );
};

const readSelectedFiles = async (input: {
  baseUrl: string;
  projectPath: string;
  ref: string;
  manifests: string[];
  sources: string[];
}): Promise<{ files: RepositoryFileContent[]; warnings: string[] }> => {
  const files: RepositoryFileContent[] = [];
  const warnings: string[] = [];
  let totalBytes = 0;

  for (const selectedPath of [...input.manifests, ...input.sources]) {
    const purpose = input.manifests.includes(selectedPath) ? 'manifest' : 'source';

    try {
      const rawContent = await readGitLabRepositoryFile(
        input.baseUrl,
        input.projectPath,
        input.ref,
        selectedPath,
      );
      const content = redactSensitiveValues(rawContent);
      const contentBytes = Buffer.byteLength(content, 'utf8');

      if (totalBytes + contentBytes > env.repositoryAnalysisMaxPromptBytes) {
        warnings.push(
          `خواندن فایل‌ها پیش از ${selectedPath} متوقف شد، زیرا سقف محتوای مجاز برای تحلیل پر شد.`,
        );
        break;
      }

      totalBytes += contentBytes;
      files.push({ path: selectedPath, content, purpose });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`خواندن فایل ${selectedPath} ممکن نبود: ${message}`);
    }
  }

  return { files, warnings };
};

const addPackage = (
  output: RepositoryPackageRecord[],
  record: RepositoryPackageRecord,
): void => {
  if (!record.name) return;

  const key = `${record.ecosystem}:${record.category}:${record.name}:${record.manifestPath}`;
  const exists = output.some(
    (item) =>
      `${item.ecosystem}:${item.category}:${item.name}:${item.manifestPath}` === key,
  );

  if (!exists) output.push(record);
};

const parseJsonManifest = (
  file: RepositoryFileContent,
  packages: RepositoryPackageRecord[],
): void => {
  let parsed: any;

  try {
    parsed = JSON.parse(file.content);
  } catch {
    return;
  }

  const baseName = path.posix.basename(file.path).toLowerCase();

  if (baseName === 'package.json') {
    const sections: Array<[
      string,
      RepositoryPackageRecord['category'],
    ]> = [
      ['dependencies', 'runtime'],
      ['devDependencies', 'development'],
      ['peerDependencies', 'peer'],
      ['optionalDependencies', 'optional'],
    ];

    for (const [sectionName, category] of sections) {
      const values = parsed?.[sectionName];
      if (!values || typeof values !== 'object') continue;

      for (const [name, version] of Object.entries(values)) {
        addPackage(packages, {
          name,
          version: String(version || ''),
          ecosystem: 'npm',
          category,
          manifestPath: file.path,
        });
      }
    }
  }

  if (baseName === 'composer.json') {
    for (const [sectionName, category] of [
      ['require', 'runtime'],
      ['require-dev', 'development'],
    ] as const) {
      const values = parsed?.[sectionName];
      if (!values || typeof values !== 'object') continue;

      for (const [name, version] of Object.entries(values)) {
        addPackage(packages, {
          name,
          version: String(version || ''),
          ecosystem: 'composer',
          category,
          manifestPath: file.path,
        });
      }
    }
  }
}

const parseRequirements = (
  file: RepositoryFileContent,
  packages: RepositoryPackageRecord[],
): void => {
  for (const rawLine of file.content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#') || line.startsWith('-')) continue;

    const match = line.match(/^([A-Za-z0-9_.-]+)\s*(.*)$/);
    if (!match) continue;

    addPackage(packages, {
      name: match[1],
      version: match[2].trim(),
      ecosystem: 'python',
      category: 'runtime',
      manifestPath: file.path,
    });
  }
};

const parsePyProject = (
  file: RepositoryFileContent,
  packages: RepositoryPackageRecord[],
): void => {
  let section = '';

  for (const rawLine of file.content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);

    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    if (!line || line.startsWith('#')) continue;

    if (
      section === 'tool.poetry.dependencies' ||
      section === 'project.dependencies' ||
      section === 'tool.poetry.group.dev.dependencies'
    ) {
      const keyValue = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);

      if (keyValue && keyValue[1].toLowerCase() !== 'python') {
        addPackage(packages, {
          name: keyValue[1],
          version: keyValue[2].replace(/["']/g, '').trim(),
          ecosystem: 'python',
          category: section.includes('dev') ? 'development' : 'runtime',
          manifestPath: file.path,
        });
      }

      const quoted = line.match(/["']([A-Za-z0-9_.-]+)([^"']*)["']/);
      if (section === 'project.dependencies' && quoted) {
        addPackage(packages, {
          name: quoted[1],
          version: quoted[2].trim(),
          ecosystem: 'python',
          category: 'runtime',
          manifestPath: file.path,
        });
      }
    }
  }
};

const parseGoMod = (
  file: RepositoryFileContent,
  packages: RepositoryPackageRecord[],
): void => {
  let inRequireBlock = false;

  for (const rawLine of file.content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line === 'require (') {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line === ')') {
      inRequireBlock = false;
      continue;
    }

    const candidate = line.startsWith('require ')
      ? line.slice('require '.length).trim()
      : inRequireBlock
        ? line
        : '';

    if (!candidate || candidate.startsWith('//')) continue;

    const [name, version = ''] = candidate.split(/\s+/);
    if (!name) continue;

    addPackage(packages, {
      name,
      version,
      ecosystem: 'go',
      category: 'runtime',
      manifestPath: file.path,
    });
  }
};

const parseCargoToml = (
  file: RepositoryFileContent,
  packages: RepositoryPackageRecord[],
): void => {
  let category: RepositoryPackageRecord['category'] = 'unknown';

  for (const rawLine of file.content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (/^\[dependencies\]$/i.test(line)) category = 'runtime';
    else if (/^\[dev-dependencies\]$/i.test(line)) category = 'development';
    else if (/^\[build-dependencies\]$/i.test(line)) category = 'development';
    else if (/^\[/.test(line)) category = 'unknown';
    else {
      const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
      if (!match || category === 'unknown') continue;

      addPackage(packages, {
        name: match[1],
        version: match[2].replace(/["']/g, '').trim(),
        ecosystem: 'cargo',
        category,
        manifestPath: file.path,
      });
    }
  }
};

const parsePubspec = (
  file: RepositoryFileContent,
  packages: RepositoryPackageRecord[],
): void => {
  let category: RepositoryPackageRecord['category'] = 'unknown';

  for (const rawLine of file.content.split(/\r?\n/)) {
    if (/^dependencies:\s*$/.test(rawLine)) category = 'runtime';
    else if (/^dev_dependencies:\s*$/.test(rawLine)) category = 'development';
    else if (/^[^\s#][^:]*:\s*$/.test(rawLine)) category = 'unknown';
    else {
      const match = rawLine.match(/^\s{2}([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match || category === 'unknown' || match[1] === 'flutter') continue;

      addPackage(packages, {
        name: match[1],
        version: match[2].trim(),
        ecosystem: 'pub',
        category,
        manifestPath: file.path,
      });
    }
  }
};

const parseXmlPackages = (
  file: RepositoryFileContent,
  packages: RepositoryPackageRecord[],
): void => {
  const isCsProject = /\.csproj$/i.test(file.path) || /Directory\.Packages\.props$/i.test(file.path);

  if (isCsProject) {
    const regex = /<PackageReference\s+[^>]*Include=["']([^"']+)["'][^>]*(?:Version=["']([^"']+)["'])?[^>]*\/?>(?:\s*<Version>([^<]+)<\/Version>)?/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(file.content))) {
      addPackage(packages, {
        name: match[1],
        version: match[2] || match[3] || '',
        ecosystem: 'nuget',
        category: 'runtime',
        manifestPath: file.path,
      });
    }
  }

  if (/pom\.xml$/i.test(file.path)) {
    const dependencyRegex = /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?(?:<version>([^<]+)<\/version>)?[\s\S]*?<\/dependency>/gi;
    let match: RegExpExecArray | null;

    while ((match = dependencyRegex.exec(file.content))) {
      addPackage(packages, {
        name: `${match[1]}:${match[2]}`,
        version: match[3] || '',
        ecosystem: 'maven',
        category: 'runtime',
        manifestPath: file.path,
      });
    }
  }
};

const parseGradle = (
  file: RepositoryFileContent,
  packages: RepositoryPackageRecord[],
): void => {
  const regex = /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|androidTestImplementation)\s*\(?["']([^:"']+):([^:"']+):([^"']+)["']\)?/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(file.content))) {
    addPackage(packages, {
      name: `${match[1]}:${match[2]}`,
      version: match[3],
      ecosystem: 'gradle',
      category: /test/i.test(match[0]) ? 'development' : 'runtime',
      manifestPath: file.path,
    });
  }
};

const parsePackages = (
  files: RepositoryFileContent[],
): RepositoryPackageRecord[] => {
  const packages: RepositoryPackageRecord[] = [];

  for (const file of files.filter((item) => item.purpose === 'manifest')) {
    const baseName = path.posix.basename(file.path).toLowerCase();

    if (['package.json', 'composer.json'].includes(baseName)) {
      parseJsonManifest(file, packages);
    } else if (/^requirements(?:-[^/]+)?\.txt$/i.test(baseName)) {
      parseRequirements(file, packages);
    } else if (baseName === 'pyproject.toml') {
      parsePyProject(file, packages);
    } else if (baseName === 'go.mod') {
      parseGoMod(file, packages);
    } else if (baseName === 'cargo.toml') {
      parseCargoToml(file, packages);
    } else if (baseName === 'pubspec.yaml') {
      parsePubspec(file, packages);
    } else if (
      /\.csproj$/i.test(file.path) ||
      /Directory\.Packages\.props$/i.test(file.path) ||
      baseName === 'pom.xml'
    ) {
      parseXmlPackages(file, packages);
    } else if (/build\.gradle(?:\.kts)?$/i.test(file.path)) {
      parseGradle(file, packages);
    }
  }

  return packages.sort(
    (a, b) =>
      a.ecosystem.localeCompare(b.ecosystem) ||
      a.category.localeCompare(b.category) ||
      a.name.localeCompare(b.name),
  );
};

const detectFrameworks = (
  packages: RepositoryPackageRecord[],
  filePaths: string[],
  inspectedFiles: RepositoryFileContent[],
): string[] => {
  const names = new Set(packages.map((item) => item.name.toLowerCase()));
  const inspectedContent = inspectedFiles
    .map((item) => item.content)
    .join('\n')
    .toLowerCase();
  const mentions = (packageName: string): boolean =>
    inspectedContent.includes(`'${packageName.toLowerCase()}'`) ||
    inspectedContent.includes(`"${packageName.toLowerCase()}"`) ||
    inspectedContent.includes(`from ${packageName.toLowerCase()}`) ||
    inspectedContent.includes(`import ${packageName.toLowerCase()}`);
  const frameworks: string[] = [];
  const add = (name: string, condition: boolean): void => {
    if (condition) frameworks.push(name);
  };

  add('Express', names.has('express') || mentions('express'));
  add('NestJS', [...names].some((name) => name.startsWith('@nestjs/')));
  add('Next.js', names.has('next') || mentions('next'));
  add('React', names.has('react') || mentions('react'));
  add('Vue', names.has('vue') || mentions('vue'));
  add('Nuxt', names.has('nuxt'));
  add('Angular', names.has('@angular/core'));
  add('Svelte', names.has('svelte') || mentions('svelte'));
  add('Mongoose', names.has('mongoose') || mentions('mongoose'));
  add(
    'Prisma',
    names.has('@prisma/client') ||
      names.has('prisma') ||
      mentions('@prisma/client'),
  );
  add('TypeORM', names.has('typeorm') || mentions('typeorm'));
  add('Sequelize', names.has('sequelize') || mentions('sequelize'));
  add('Django', names.has('django') || mentions('django'));
  add('FastAPI', names.has('fastapi') || mentions('fastapi'));
  add('Flask', names.has('flask') || mentions('flask'));
  add('SQLAlchemy', names.has('sqlalchemy') || mentions('sqlalchemy'));
  add('ASP.NET Core', [...names].some((name) => name.includes('microsoft.aspnetcore')) || filePaths.some((item) => /Program\.cs$/i.test(item)));
  add('Spring Boot', [...names].some((name) => name.includes('spring-boot')));
  add('Laravel', names.has('laravel/framework'));
  add('Flutter', names.has('flutter') || filePaths.some((item) => /pubspec\.yaml$/i.test(item)));
  add('Docker', filePaths.some((item) => /(^|\/)Dockerfile/i.test(item)));
  add('Docker Compose', filePaths.some((item) => /(^|\/)(docker-compose|compose).*\.ya?ml$/i.test(item)));
  add('GitLab CI', filePaths.some((item) => /(^|\/)\.gitlab-ci\.ya?ml$/i.test(item)));

  return uniqueSorted(frameworks);
};

const inferModules = (filePaths: string[]): string[] => {
  const candidates = new Set<string>();
  const ignoredNames = new Set([
    'config',
    'shared',
    'common',
    'utils',
    'types',
    'middleware',
    'middlewares',
    'database',
    'docs',
    'postman',
    'tests',
    'test',
    'scripts',
    'assets',
    'public',
    'index',
  ]);
  const addCandidate = (value?: string): void => {
    if (!value) return;
    const normalized = value.trim();
    const comparisonValue = normalized.toLowerCase();
    if (!normalized || normalized.includes('.') || ignoredNames.has(comparisonValue)) {
      return;
    }
    candidates.add(normalized);
  };

  for (const filePath of filePaths) {
    const segments = normalizePath(filePath).split('/');
    const moduleIndex = segments.findIndex((segment) =>
      ['modules', 'features', 'apps', 'services', 'packages'].includes(
        segment.toLowerCase(),
      ),
    );

    if (moduleIndex >= 0 && segments[moduleIndex + 1]) {
      addCandidate(segments[moduleIndex + 1]);
      continue;
    }

    if (segments[0] === 'src' && segments[1] && segments.length > 2) {
      addCandidate(segments[1]);
    }
  }

  return [...candidates].sort().slice(0, 50);
};

const inferArchitecture = (input: {
  filePaths: string[];
  frameworks: string[];
  modules: string[];
  languages: RepositoryLanguageRecord[];
}): RepositoryArchitectureResult => {
  const normalizedPaths = input.filePaths.map((item) => normalizePath(item));
  const has = (pattern: RegExp): boolean =>
    normalizedPaths.some((item) => pattern.test(item));

  const hasDomain = has(/(^|\/)domain(\/|$)/i);
  const hasApplication = has(/(^|\/)application(\/|$)/i);
  const hasInfrastructure = has(/(^|\/)infrastructure(\/|$)/i);
  const hasPresentation = has(/(^|\/)(presentation|api)(\/|$)/i);
  const hasModules = has(/(^|\/)(modules|features)(\/|$)/i);
  const hasControllers = has(
    /(^|\/)(controllers?(\/|$)|[^/]+\.controller\.[^/]+$)/i,
  );
  const hasServices = has(
    /(^|\/)(services?(\/|$)|[^/]+\.service\.[^/]+$)/i,
  );
  const hasRepositories = has(
    /(^|\/)(repositories?(\/|$)|[^/]+\.repository\.[^/]+$)/i,
  );
  const hasModels = has(
    /(^|\/)((models?|entities?)(\/|$)|[^/]+\.(model|entity)\.[^/]+$)/i,
  );
  const hasMultipleApps =
    new Set(
      normalizedPaths
        .filter((item) => /^(apps|services|packages)\//i.test(item))
        .map((item) => item.split('/').slice(0, 2).join('/')),
    ).size > 1;

  let classification = 'اپلیکیشن سازمان‌یافته';
  let confidence = 0.55;
  const layers: string[] = [];
  const strengths: string[] = [];
  const concerns: string[] = [];
  const evidence: string[] = [];

  if (hasDomain && hasApplication && hasInfrastructure) {
    classification = 'معماری پاک / معماری دامنه‌محور';
    confidence = 0.88;
    layers.push('دامنه', 'کاربرد', 'زیرساخت');
    if (hasPresentation) layers.push('ارائه/API');
    strengths.push('مرزهای وابستگی به‌صورت صریح در ساختار پوشه‌ها مشخص شده‌اند.');
    evidence.push('پوشه‌های domain، application و infrastructure در مخزن وجود دارند.');
  } else if (hasMultipleApps) {
    classification = 'مونوریپو با چند اپلیکیشن یا سرویس';
    confidence = 0.82;
    strengths.push('چند واحد قابل استقرار یا قابل استفاده مجدد در سطح مخزن از یکدیگر جدا شده‌اند.');
    evidence.push('چند پوشه مجزا زیر apps، services یا packages شناسایی شد.');
  } else if (hasModules && hasControllers && hasServices) {
    classification = 'مونولیت ماژولار مبتنی بر قابلیت';
    confidence = 0.86;
    layers.push('ماژول‌های قابلیت‌محور', 'HTTP/کنترلرها', 'سرویس‌ها');
    if (hasModels) layers.push('مدل‌های ذخیره‌سازی');
    if (hasRepositories) layers.push('مخازن/دسترسی به داده');
    strengths.push('قابلیت‌های کسب‌وکار در ماژول‌های مشخص و مستقل گروه‌بندی شده‌اند.');
    evidence.push('ساختار modules/features همراه با کنترلرها و سرویس‌ها در مخزن وجود دارد.');
  } else if (hasControllers && hasServices) {
    classification = 'معماری لایه‌ای اپلیکیشن';
    confidence = 0.78;
    layers.push('کنترلرها', 'سرویس‌ها');
    if (hasRepositories) layers.push('مخازن داده');
    if (hasModels) layers.push('مدل‌ها/موجودیت‌ها');
    strengths.push('پردازش HTTP و منطق سرویس‌ها از نظر ساختاری از یکدیگر جدا شده‌اند.');
    evidence.push('فایل‌ها یا پوشه‌های کنترلر و سرویس در مخزن شناسایی شدند.');
  } else if (
    input.frameworks.some((item) =>
      ['React', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt'].includes(item),
    )
  ) {
    classification = 'اپلیکیشن فرانت‌اند مبتنی بر کامپوننت';
    confidence = 0.74;
    layers.push('صفحات/نماها', 'کامپوننت‌ها', 'وضعیت/دسترسی به داده');
    evidence.push('یک فریم‌ورک فرانت‌اند مبتنی بر کامپوننت شناسایی شد.');
  } else {
    concerns.push(
      'ساختار بررسی‌شده مرزهای معماری متعارف کافی برای یک طبقه‌بندی با اطمینان بالا را نشان نمی‌دهد.',
    );
  }

  if (input.modules.length > 0) {
    strengths.push(`${input.modules.length} ماژول احتمالی کسب‌وکار یا اپلیکیشن شناسایی شد.`);
  } else {
    concerns.push('مرز مشخصی برای ماژول‌های کسب‌وکار از روی ساختار مخزن شناسایی نشد.');
  }

  if (!hasServices && hasControllers) {
    concerns.push('کنترلرها وجود دارند، اما لایه سرویس مستقل و مشخصی شناسایی نشد.');
  }

  if (input.frameworks.includes('Docker')) {
    strengths.push('پیکربندی کانتینر در مخزن وجود دارد.');
  }

  if (!input.frameworks.includes('GitLab CI')) {
    concerns.push('پیکربندی GitLab CI در ساختار بررسی‌شده مخزن شناسایی نشد.');
  }

  const mainLanguage = input.languages[0]?.name || 'نامشخص';
  const summary = `${classification}. زبان غالب شناسایی‌شده ${mainLanguage} است. ${
    input.modules.length > 0
      ? `ماژول‌های احتمالی مخزن شامل ${input.modules.slice(0, 8).join('، ')} هستند.`
      : 'تنها بر اساس نام‌گذاری فایل‌ها، فهرست پایداری از ماژول‌ها قابل استخراج نبود.'
  }`;

  return {
    classification,
    confidence,
    summary,
    layers: uniqueSorted(layers),
    modules: input.modules,
    strengths: uniqueSorted(strengths),
    concerns: uniqueSorted(concerns),
    evidence: uniqueSorted(evidence),
  };
};

const buildReports = (input: {
  inventory: RepositoryInventory;
  packages: RepositoryPackageRecord[];
  frameworks: string[];
  architecture: RepositoryArchitectureResult;
}): { executiveReport: string; technicalReport: string } => {
  const primaryLanguages = input.inventory.languages
    .slice(0, 5)
    .map((item) => `${item.name} (${item.fileCount} فایل)`)
    .join('، ');
  const packageCounts = input.packages.reduce<Record<string, number>>(
    (accumulator, item) => {
      accumulator[item.ecosystem] = (accumulator[item.ecosystem] || 0) + 1;
      return accumulator;
    },
    {},
  );
  const packageSummary = Object.entries(packageCounts)
    .map(([ecosystem, count]) => `${ecosystem}: ${count}`)
    .join('، ');

  const executiveReport = [
    `معماری: ${input.architecture.classification}.`,
    `فناوری‌های اصلی: ${input.frameworks.join('، ') || 'هیچ فریم‌ورکی با اطمینان کافی شناسایی نشد'}.`,
    `اندازه مخزن: ${input.inventory.totalFiles} فایل و ${input.inventory.totalDirectories} پوشه در ساختار بررسی‌شده GitLab.`,
    `زبان‌های اصلی: ${primaryLanguages || 'شناسایی نشد'}.`,
    `تعداد وابستگی‌های تعریف‌شده: ${input.packages.length}${packageSummary ? ` (${packageSummary})` : ''}.`,
    input.architecture.concerns.length > 0
      ? `مهم‌ترین نگرانی‌های ساختاری: ${input.architecture.concerns.slice(0, 3).join(' ')}`
      : 'در بررسی ایستای مرحله اول، نگرانی ساختاری مهمی استنباط نشد.',
  ].join('\n');

  const technicalReport = [
    input.architecture.summary,
    `لایه‌ها: ${input.architecture.layers.join('، ') || 'با اطمینان کافی شناسایی نشد'}.`,
    `ماژول‌های احتمالی: ${input.architecture.modules.join('، ') || 'با اطمینان کافی شناسایی نشد'}.`,
    `فایل‌های مانیفست: ${input.inventory.manifestFiles.join('، ') || 'شناسایی نشد'}.`,
    `فایل‌های نمونه بررسی‌شده: ${input.inventory.selectedSourceFiles.join('، ') || 'هیچ‌کدام'}.`,
    `نقاط قوت: ${input.architecture.strengths.join(' ') || 'نقطه قوت قطعی از تحلیل ایستا استخراج نشد.'}`,
    `نگرانی‌ها: ${input.architecture.concerns.join(' ') || 'نگرانی قطعی از تحلیل ایستا استخراج نشد.'}`,
  ].join('\n');

  return { executiveReport, technicalReport };
};

export const runDeterministicRepositoryAnalysis = async (input: {
  baseUrl: string;
  projectPath: string;
  ref: string;
  entries: GitLabTreeEntry[];
  truncated: boolean;
}): Promise<DeterministicRepositoryAnalysis> => {
  const filteredEntries = input.entries.filter(
    (entry) => !isIgnoredPath(entry.path),
  );
  const files = filteredEntries.filter((entry) => entry.type === 'blob');
  const directories = filteredEntries.filter((entry) => entry.type === 'tree');
  const selection = selectFiles(files);
  const fileReadResult = await readSelectedFiles({
    baseUrl: input.baseUrl,
    projectPath: input.projectPath,
    ref: input.ref,
    manifests: selection.manifests,
    sources: selection.sources,
  });
  const packages = parsePackages(fileReadResult.files);
  const allPaths = filteredEntries.map((entry) => entry.path);
  const frameworks = detectFrameworks(
    packages,
    allPaths,
    fileReadResult.files,
  );
  const modules = inferModules(allPaths);
  const languages = buildLanguages(files);
  const inventory: RepositoryInventory = {
    totalEntries: filteredEntries.length,
    totalFiles: files.length,
    totalDirectories: directories.length,
    truncated: input.truncated,
    topLevelDirectories: uniqueSorted(
      directories
        .filter((entry) => !normalizePath(entry.path).includes('/'))
        .map((entry) => getTopLevelName(entry.path)),
    ),
    topLevelFiles: uniqueSorted(
      files
        .filter((entry) => !normalizePath(entry.path).includes('/'))
        .map((entry) => entry.path),
    ),
    manifestFiles: selection.detectedManifests,
    selectedSourceFiles: fileReadResult.files
      .filter((item) => item.purpose === 'source')
      .map((item) => item.path),
    languages,
  };
  const architecture = inferArchitecture({
    filePaths: allPaths,
    frameworks,
    modules,
    languages,
  });
  const reports = buildReports({
    inventory,
    packages,
    frameworks,
    architecture,
  });
  const warnings = [...fileReadResult.warnings];

  if (input.truncated) {
    warnings.push(
      `تعداد آیتم‌های ساختار مخزن از سقف تنظیم‌شده ${env.repositoryAnalysisMaxFiles} عبور کرد؛ نتایج بر اساس فهرست ناقص مخزن تولید شده‌اند.`,
    );
  }

  return {
    inventory,
    files: fileReadResult.files,
    packages,
    frameworks,
    architecture,
    executiveReport: reports.executiveReport,
    technicalReport: reports.technicalReport,
    warnings,
  };
};
