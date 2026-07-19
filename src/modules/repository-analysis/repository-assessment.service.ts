import type {
  RepositoryArchitectureResult,
  RepositoryCodeReviewAssessment,
  RepositoryCodeReviewFinding,
  RepositoryExpectationsSnapshot,
  RepositoryInventory,
  RepositoryPackageRecord,
  RepositoryReadinessAssessment,
  RepositoryRecommendation,
  RepositoryRequirementMatch,
  RepositoryScalabilityAssessment,
} from './repository-analysis.model';
import type { RepositoryFileContent } from './repository-static-analysis.service';

const unique = (values: string[]): string[] =>
  [...new Set(values.map((item) => item.trim()).filter(Boolean))];

const extractExpectationItems = (content: string): string[] => {
  if (!content.trim()) return [];

  const lines = content
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|#+\s*)/, '').trim())
    .filter((line) => line.length >= 12 && line.length <= 500)
    .filter((line) => !/^##\s*/.test(line));

  return unique(lines).slice(0, 30);
};

const packageNames = (packages: RepositoryPackageRecord[]): Set<string> =>
  new Set(packages.map((item) => item.name.toLowerCase()));

const hasPackagePart = (names: Set<string>, parts: string[]): boolean =>
  [...names].some((name) => parts.some((part) => name.includes(part)));

const makeRecommendation = (
  priority: RepositoryRecommendation['priority'],
  title: string,
  description: string,
  suggestedSolution: string,
  evidence: string[] = [],
): RepositoryRecommendation => ({
  priority,
  title,
  description,
  suggestedSolution,
  evidence,
});

export const buildDeterministicRepositoryAssessments = (input: {
  expectations: RepositoryExpectationsSnapshot;
  expectationsContent: string;
  inventory: RepositoryInventory;
  packages: RepositoryPackageRecord[];
  frameworks: string[];
  architecture: RepositoryArchitectureResult;
  files: RepositoryFileContent[];
  repositoryPaths: string[];
}): {
  readinessAssessment: RepositoryReadinessAssessment;
  scalabilityAssessment: RepositoryScalabilityAssessment;
  codeReviewAssessment: RepositoryCodeReviewAssessment;
} => {
  const paths = input.repositoryPaths.map((item) => item.replace(/\\/g, '/'));
  const names = packageNames(input.packages);
  const expectationItems = extractExpectationItems(input.expectationsContent);
  const testPaths = paths.filter((item) =>
    /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^/]+$/i.test(item),
  );
  const ciPaths = paths.filter((item) => /(^|\/)\.gitlab-ci\.ya?ml$/i.test(item));
  const dockerPaths = paths.filter((item) =>
    /(^|\/)(Dockerfile(?:\.[^/]+)?|(docker-compose|compose)(?:\.[^/]+)?\.ya?ml)$/i.test(item),
  );
  const largeFiles = input.files
    .map((file) => ({ path: file.path, lines: file.content.split('\n').length }))
    .filter((item) => item.lines >= 700)
    .sort((a, b) => b.lines - a.lines);
  const todoCount = input.files.reduce(
    (count, file) => count + (file.content.match(/\b(TODO|FIXME|HACK)\b/gi) || []).length,
    0,
  );
  const consolePaths = input.files
    .filter((file) => /\bconsole\.(log|error|warn|debug)\s*\(/.test(file.content))
    .map((file) => file.path);

  const hasQueue = hasPackagePart(names, [
    'bull',
    'bullmq',
    'amqplib',
    'rabbitmq',
    'kafkajs',
    'celery',
  ]);
  const hasCache = hasPackagePart(names, ['redis', 'ioredis', 'memcached']);
  const hasTests = testPaths.length > 0 || hasPackagePart(names, [
    'jest',
    'vitest',
    'mocha',
    'pytest',
    'phpunit',
    'xunit',
    'nunit',
  ]);
  const hasLint = hasPackagePart(names, ['eslint', 'ruff', 'pylint', 'stylelint']);

  const matchedExpectations: RepositoryRequirementMatch[] = expectationItems.map(
    (expectation) => ({
      expectation,
      status: 'unknown',
      evidence: [],
      explanation:
        'این الزام از فایل انتظارات استخراج شد، اما برای تایید قطعی آن به تحلیل هوش مصنوعی، تست اجرایی یا شواهد عملیاتی نیاز است.',
    }),
  );

  const readinessRecommendations: RepositoryRecommendation[] = [];
  const readinessGaps: string[] = [];

  if (!input.expectations.provided) {
    readinessGaps.push(
      'فایل یا متن انتظارات پروژه ارائه نشده است؛ بنابراین امکان مقایسه پروژه با معیار پذیرش کسب‌وکار وجود ندارد.',
    );
    readinessRecommendations.push(
      makeRecommendation(
        'high',
        'تعریف معیارهای پذیرش',
        'آمادگی پروژه بدون معیارهای مشخص محصول، بار، امنیت و عملیات قابل قضاوت نیست.',
        'فایل انتظارات، سناریوهای اصلی، SLA، تعداد کاربران همزمان و محدودیت‌های امنیتی را همراه تحلیل بعدی ارسال کنید.',
      ),
    );
  }

  if (!hasTests) {
    readinessGaps.push('در ساختار بررسی‌شده، تست خودکار قابل تشخیص نبود.');
    readinessRecommendations.push(
      makeRecommendation(
        'high',
        'ایجاد خط پایه تست خودکار',
        'بدون تست‌های قابل تکرار، تایید آمادگی انتشار و جلوگیری از رگرسیون قابل اتکا نیست.',
        'برای مسیرهای بحرانی واحد، یکپارچه و API تست اضافه کنید و اجرای آن را به CI متصل کنید.',
        testPaths,
      ),
    );
  }

  if (ciPaths.length === 0) {
    readinessGaps.push('فایل GitLab CI در مخزن شناسایی نشد.');
    readinessRecommendations.push(
      makeRecommendation(
        'medium',
        'افزودن کنترل کیفیت در CI',
        'Build، lint و test باید پیش از ادغام یا انتشار به‌صورت تکرارپذیر اجرا شوند.',
        'یک pipeline حداقلی برای install، type-check، lint، test و build ایجاد کنید.',
      ),
    );
  }

  const readinessAssessment: RepositoryReadinessAssessment = {
    verdict: 'insufficient_evidence',
    score: input.expectations.provided ? Math.max(20, 55 - readinessGaps.length * 8) : 0,
    confidence: 0.35,
    summary: input.expectations.provided
      ? 'مقایسه اولیه انجام شد، اما تحلیل ایستا به‌تنهایی برای اعلام آمادگی قطعی پروژه کافی نیست. نتیجه نهایی باید با شواهد تست، استقرار و معیارهای پذیرش تکمیل شود.'
      : 'به‌دلیل نبود فایل انتظارات، فقط ساختار فنی مخزن بررسی شده و آمادگی نسبت به نیازهای پروژه قابل تایید نیست.',
    matchedExpectations,
    blockers: [],
    gaps: unique(readinessGaps),
    recommendations: readinessRecommendations,
  };

  const workload = input.expectations.workloadTargets;
  const workloadAssumptions = unique([
    workload.concurrentUsers
      ? `${workload.concurrentUsers} کاربر همزمان`
      : 'تعداد کاربران همزمان مشخص نشده است.',
    workload.requestsPerSecond
      ? `${workload.requestsPerSecond} درخواست در ثانیه`
      : 'نرخ درخواست هدف مشخص نشده است.',
    workload.targetLatencyMs
      ? `تاخیر هدف ${workload.targetLatencyMs} میلی‌ثانیه`
      : 'بودجه تاخیر پاسخ مشخص نشده است.',
    workload.availabilityPercent
      ? `دسترس‌پذیری هدف ${workload.availabilityPercent} درصد`
      : 'SLA دسترس‌پذیری مشخص نشده است.',
    workload.dataVolume ? `حجم داده هدف: ${workload.dataVolume}` : '',
  ]);

  const scalabilityStrengths = unique([
    /ماژولار/.test(input.architecture.classification)
      ? 'مرزبندی ماژولار می‌تواند جداسازی مسیرهای پرترافیک و توسعه تدریجی را ساده‌تر کند.'
      : '',
    dockerPaths.length > 0
      ? 'پیکربندی کانتینر، تکثیر افقی سرویس را از نظر استقرار ساده‌تر می‌کند.'
      : '',
    hasQueue
      ? 'وجود ابزار صف، امکان انتقال کارهای طولانی و غیرهمزمان از مسیر درخواست را فراهم می‌کند.'
      : '',
    hasCache
      ? 'وجود ابزار cache می‌تواند فشار خواندن تکراری از پایگاه داده را کاهش دهد.'
      : '',
  ]);

  const bottlenecks = unique([
    !hasQueue
      ? 'ابزار صف یا پردازش غیرهمزمان در وابستگی‌های بررسی‌شده شناسایی نشد؛ کارهای طولانی می‌توانند ظرفیت HTTP را اشغال کنند.'
      : '',
    !hasCache
      ? 'لایه cache در وابستگی‌های بررسی‌شده شناسایی نشد؛ بارهای خواندنی تکراری ممکن است مستقیماً به پایگاه داده منتقل شوند.'
      : '',
    /مونولیت/.test(input.architecture.classification)
      ? 'در مونولیت، مسیرهای سبک و سنگین معمولاً یک واحد استقرار و یک مخزن منابع را به اشتراک می‌گذارند.'
      : '',
    largeFiles.length > 0
      ? 'چند فایل بسیار بزرگ در نمونه بررسی‌شده وجود دارد که معمولاً نشانه تراکم مسئولیت و دشواری بهینه‌سازی موضعی است.'
      : '',
  ]);

  const scalabilityAssessment: RepositoryScalabilityAssessment = {
    verdict: 'insufficient_evidence',
    confidence: 0.4,
    summary:
      'از روی کد و ساختار مخزن نمی‌توان ظرفیت عددی کاربران یا درخواست‌ها را تضمین کرد. معماری فقط از نظر ریسک‌های مقیاس‌پذیری بررسی شده و تایید ظرفیت به تست بار و داده‌های production نیاز دارد.',
    workloadAssumptions,
    strengths: scalabilityStrengths,
    bottlenecks,
    capacityRisks: unique([
      'ظرفیت connection pool پایگاه داده و رفتار queryها از تحلیل ایستا قابل اندازه‌گیری نیست.',
      'مصرف CPU و حافظه هر درخواست، اندازه payload و نرخ عملیات خارجی مشخص نیست.',
      'نبود اندازه‌گیری p95 و p99 باعث می‌شود نقطه شکست سامانه نامعلوم بماند.',
    ]),
    recommendedArchitecture: unique([
      !hasQueue
        ? 'کارهای طولانی، گزارش‌گیری و پردازش‌های AI را به worker مستقل و صف پایدار منتقل کنید.'
        : '',
      !hasCache
        ? 'برای داده‌های پرتکرار cache با سیاست انقضا و invalidation مشخص اضافه کنید.'
        : '',
      'API را stateless نگه دارید تا چند replica پشت load balancer قابل اجرا باشد.',
      'برای پایگاه داده index، slow query log، connection pool و replica/read scaling را بر اساس الگوی واقعی بار تنظیم کنید.',
      'برای هر مسیر بحرانی timeout، retry محدود، circuit breaker و محدودیت نرخ تعریف کنید.',
    ]),
    validationPlan: [
      'سناریوهای واقعی را با k6، JMeter یا ابزار مشابه در محیط شبیه production اجرا کنید.',
      'بار را مرحله‌ای افزایش دهید و نقطه اشباع CPU، حافظه، connection pool و پایگاه داده را ثبت کنید.',
      'p50، p95، p99، نرخ خطا، throughput و طول صف را برای هر سناریو اندازه‌گیری کنید.',
      'تست soak برای نشت حافظه و تست spike برای جهش ناگهانی ترافیک اجرا کنید.',
      'پس از هر تغییر معماری، همان سناریو را تکرار و نتیجه را با baseline مقایسه کنید.',
    ],
  };

  const findings: RepositoryCodeReviewFinding[] = [];
  let maintainabilityScore = 80;
  let reliabilityScore = 70;
  let securityScore = 65;
  let performanceScore = 65;

  if (largeFiles.length > 0) {
    maintainabilityScore -= Math.min(25, largeFiles.length * 5);
    findings.push({
      severity: 'medium',
      category: 'maintainability',
      title: 'فایل‌های با تراکم مسئولیت بالا',
      description: `${largeFiles.length} فایل نمونه بیش از ۷۰۰ خط دارند و احتمال ترکیب چند مسئولیت در آن‌ها بالاست.`,
      evidencePaths: largeFiles.slice(0, 8).map((item) => `${item.path} (${item.lines} lines)`),
      recommendation: 'منطق دامنه، orchestration، validation و دسترسی به داده را به واحدهای کوچک‌تر با قرارداد روشن تفکیک کنید.',
    });
  }

  if (!hasTests) {
    reliabilityScore -= 25;
    findings.push({
      severity: 'high',
      category: 'reliability',
      title: 'نبود شواهد کافی از تست خودکار',
      description: 'فایل یا dependency قابل اتکایی برای تست خودکار در ساختار بررسی‌شده پیدا نشد.',
      evidencePaths: [],
      recommendation: 'ابتدا مسیرهای احراز هویت، مجوزها، تراکنش‌ها و خطاهای سرویس‌های خارجی را با تست‌های قابل تکرار پوشش دهید.',
    });
  }

  if (ciPaths.length === 0) {
    reliabilityScore -= 10;
    findings.push({
      severity: 'medium',
      category: 'delivery',
      title: 'کنترل کیفیت خودکار پیش از ادغام مشخص نیست',
      description: 'GitLab CI در فهرست مخزن شناسایی نشد.',
      evidencePaths: [],
      recommendation: 'pipeline اجباری برای type-check، lint، test، build و اسکن dependency ایجاد کنید.',
    });
  }

  if (!hasLint) {
    maintainabilityScore -= 8;
    findings.push({
      severity: 'low',
      category: 'quality',
      title: 'ابزار lint قابل تشخیص نیست',
      description: 'dependency شناخته‌شده‌ای برای lint در manifestهای خوانده‌شده شناسایی نشد.',
      evidencePaths: input.inventory.manifestFiles,
      recommendation: 'قواعد lint و format را در CI اجباری کنید تا خطاهای متداول و تفاوت سبک کاهش یابد.',
    });
  }

  if (todoCount > 0) {
    maintainabilityScore -= Math.min(10, Math.ceil(todoCount / 5));
    findings.push({
      severity: 'low',
      category: 'maintainability',
      title: 'بدهی فنی علامت‌گذاری‌شده در کد',
      description: `${todoCount} مورد TODO، FIXME یا HACK در فایل‌های نمونه مشاهده شد.`,
      evidencePaths: input.files
        .filter((file) => /\b(TODO|FIXME|HACK)\b/i.test(file.content))
        .map((file) => file.path)
        .slice(0, 12),
      recommendation: 'این موارد را به issue قابل پیگیری با owner و موعد تبدیل کنید و نشانه‌های مبهم را از کد حذف کنید.',
    });
  }

  if (consolePaths.length > 0) {
    reliabilityScore -= 5;
    findings.push({
      severity: 'low',
      category: 'observability',
      title: 'لاگ‌گذاری مستقیم در کد نمونه',
      description: 'استفاده مستقیم از console در فایل‌های نمونه مشاهده شد؛ این روش معمولاً correlation و ساختار ثابت ندارد.',
      evidencePaths: unique(consolePaths).slice(0, 12),
      recommendation: 'logger ساخت‌یافته با requestId، سطح لاگ، redaction و خروجی مناسب محیط production استفاده کنید.',
    });
  }

  if (!hasQueue) performanceScore -= 8;
  if (!hasCache) performanceScore -= 8;

  const clampScore = (value: number): number => Math.max(0, Math.min(100, value));
  maintainabilityScore = clampScore(maintainabilityScore);
  reliabilityScore = clampScore(reliabilityScore);
  securityScore = clampScore(securityScore);
  performanceScore = clampScore(performanceScore);

  const overallScore = Math.round(
    (maintainabilityScore + reliabilityScore + securityScore + performanceScore) / 4,
  );

  const codeReviewAssessment: RepositoryCodeReviewAssessment = {
    overallScore,
    summary:
      'این بازخورد نقش observer دارد و فقط بر فایل‌های منتخب و نشانه‌های ساختاری تکیه می‌کند. یافته‌ها باید پیش از تبدیل شدن به defect قطعی توسط تیم فنی بررسی شوند.',
    maintainabilityScore,
    reliabilityScore,
    securityScore,
    performanceScore,
    strengths: unique([
      input.architecture.modules.length > 0
        ? `ساختار مخزن ${input.architecture.modules.length} ماژول احتمالی را از یکدیگر جدا کرده است.`
        : '',
      hasTests ? 'نشانه‌هایی از تست خودکار در مخزن وجود دارد.' : '',
      ciPaths.length > 0 ? 'GitLab CI در مخزن وجود دارد.' : '',
      dockerPaths.length > 0 ? 'پیکربندی container در مخزن وجود دارد.' : '',
      ...input.architecture.strengths,
    ]),
    findings,
  };

  return {
    readinessAssessment,
    scalabilityAssessment,
    codeReviewAssessment,
  };
};
