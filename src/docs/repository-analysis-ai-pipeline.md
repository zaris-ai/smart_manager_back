# خط لوله تحلیل عمیق مخزن

## مرزهای معماری

Node.js همچنان Control Plane است و مسئول موارد زیر باقی می‌ماند:

- احراز هویت و مجوزها؛
- ارتباط با GitLab؛
- ذخیره وضعیت تحلیل در MongoDB؛
- مدیریت HTTP و گزارش پیشرفت؛
- اعتبارسنجی نهایی evidenceها.

Python یک Compute Layer محدود است. Node آن را با دستور زیر به‌صورت child process اجرا می‌کند:

```bash
python3 -m repository_analysis
```

Python هیچ HTTP server جداگانه‌ای ندارد و از طریق یک protocol ساده با Node ارتباط دارد:

- یک JSON از `stdin`؛
- رویدادهای JSON-line در `stderr`؛
- یک JSON نهایی در `stdout`.

## ساختار Python

```text
python/repository_analysis/
├── __main__.py       # مرز اجرای process
├── pipeline.py       # ترتیب مراحل
├── engine.py         # runner عمومی stage و loop
├── stages.py         # پاس‌های تحلیل AI
├── batching.py       # تقسیم evidenceها
├── openai_client.py  # OpenAI، retry و خطای دقیق
├── validation.py     # کنترل ساختار خروجی
├── protocol.py       # قرارداد Node/Python
├── settings.py       # تنظیمات محلی و constant کلید
├── errors.py
└── utils.py
```

## مراحل فعلی

1. استخراج اتمیک الزامات و KPIها؛
2. اجرای loop محدود بررسی batchهای فایل؛
3. ساخت ارزیابی اولیه؛
4. اجرای reviewer مخالف؛
5. تولید گزارش نهایی فارسی؛
6. اجرای loop اصلاح ساختار فقط در صورت نامعتبر بودن خروجی؛
7. کنترل نهایی evidenceها در Node.js.

## اضافه‌کردن loop جدید

برای loopهای آینده فقط از `PipelineRunner.run_loop` در `pipeline.py` استفاده شود. مزایا:

- محدودیت تعداد iteration؛
- ترتیب deterministic؛
- گزارش progress یکسان؛
- مسیر خطای یکسان؛
- عدم ایجاد `spawn()` جدید در هر feature.

کد feature نباید مستقیماً Python را اجرا کند. تمام اجرای Python باید از سرویس عمومی زیر عبور کند:

```text
src/shared/python/python-json-process.service.ts
```

و adapter ماژول تحلیل در فایل زیر باقی می‌ماند:

```text
src/modules/repository-analysis/repository-ai-python.service.ts
```

## متغیرهای محیطی

```env
REPOSITORY_ANALYSIS_AI_ENGINE=python_multi_pass
REPOSITORY_ANALYSIS_PYTHON_BIN=python3
REPOSITORY_ANALYSIS_PYTHON_PATH=python
REPOSITORY_ANALYSIS_PYTHON_MODULE=repository_analysis
REPOSITORY_ANALYSIS_AI_CHILD_TIMEOUT_MS=480000
REPOSITORY_ANALYSIS_AI_MAX_BATCHES=6
REPOSITORY_ANALYSIS_AI_BATCH_CHARS=90000
REPOSITORY_ANALYSIS_AI_MAX_OUTPUT_BYTES=8388608
REPOSITORY_ANALYSIS_AI_CRITIC_ENABLED=true
REPOSITORY_ANALYSIS_AI_FALLBACK_TO_TYPESCRIPT=true

OPENAI_REPOSITORY_ANALYSIS_MODEL=gpt-4.1-mini
OPENAI_REPOSITORY_ANALYSIS_TIMEOUT_MS=90000
```

## Docker

Image backend باید Python 3 و CA certificates داشته باشد. همچنین:

- `PYTHONPATH=/app/python`؛
- اجرای `compileall` در زمان build؛
- `init: true` در Compose برای مدیریت درست child processها؛
- `stop_grace_period` برای پایان کنترل‌شده تحلیل‌ها.

## محدودیت صریح

این قابلیت پروژه را build، اجرا، test، load test یا penetration test نمی‌کند. ظرفیت عددی فقط به‌صورت ریسک معماری بررسی می‌شود و باید با telemetry و تست بار واقعی تأیید شود.
