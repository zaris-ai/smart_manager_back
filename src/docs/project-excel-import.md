# ورود گروهی پروژه‌ها از Excel

## هدف

ورود Excel فقط برای ثبت **ساختار پروژه، زمان‌بندی، وضعیت، اولویت، فازها و اطلاعات مالی ساده فازها** استفاده می‌شود.

اطلاعات افراد و مسئولیت‌ها عمداً از Excel حذف شده است. مدیر پس از ورود پروژه، مسئول پروژه، اعضا، نقش‌ها و مسئولان فازها را از داخل سامانه انتخاب می‌کند. این تفکیک از خطاهای رایج مربوط به username، ترتیب نقش‌ها، کاربران غیرفعال و ناسازگاری مسئولان فاز جلوگیری می‌کند.

## مسیر API

```http
POST /api/v1/projects/import/excel
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

فایل باید در فیلد `file` ارسال شود. فقط مدیر یا ادمین اجازه ورود گروهی دارد.

## اصل طراحی

Excel منبع تعریف ساختار پروژه است، نه منبع مدیریت نیروی انسانی.

هنگام ورود:

```text
ownerId = null
assignedUserIds = []
projectMembers = []
phase.assignedUserIds = []
```

شناسه مدیر واردکننده فقط در `createdBy` و `updatedBy` برای ثبت تاریخچه نگهداری می‌شود و به معنی مسئول پروژه نیست.

بعد از ورود، مدیر باید تخصیص افراد را از صفحه ویرایش پروژه و فازها انجام دهد.

## ساختار فایل

فایل استاندارد دو شیت دارد:

```text
Projects  اطلاعات اصلی پروژه
Phases    فازها، زمان‌بندی و مالی ساده هر فاز
```

اگر شیت `Projects` وجود نداشته باشد، اولین شیت فایل به‌عنوان شیت پروژه‌ها خوانده می‌شود. شیت `Phases` اختیاری است.

## شیت Projects

| ستون | الزامی | توضیح |
|---|---:|---|
| `title` | بله | عنوان یکتای پروژه |
| `description` | خیر | توضیحات پروژه |
| `status` | خیر | پیش‌فرض `planning` |
| `priority` | خیر | پیش‌فرض `medium` |
| `start_date` | بله | تاریخ میلادی یا سلول Date اکسل |
| `due_date` | خیر | موعد تحویل پروژه |

وضعیت‌های مجاز:

```text
negotiating
proposal_drafting
contract_signing
planning
active
on_hold
completed
cancelled
```

اولویت‌های مجاز:

```text
low
medium
high
critical
```

## شیت Phases

هر ردیف یک فاز است. ورود فاز به شخص یا مسئول وابسته نیست.

| ستون | الزامی | توضیح |
|---|---:|---|
| `project_title` | بله | باید دقیقاً با عنوان پروژه در شیت `Projects` منطبق باشد |
| `phase_title` | بله | عنوان فاز |
| `phase_description` | خیر | توضیحات فاز |
| `phase_order` | خیر | عدد صحیح مثبت؛ پیش‌فرض ۱ |
| `phase_start_date` | بله | تاریخ شروع فاز |
| `phase_end_date` | بله | تاریخ پایان فاز |
| `expected_revenue` | خیر | درآمد پیش‌بینی‌شده؛ پیش‌فرض صفر |
| `expected_expense` | خیر | هزینه پیش‌بینی‌شده؛ پیش‌فرض صفر |
| `realized_revenue` | خیر | درآمد محقق‌شده؛ پیش‌فرض صفر |
| `realized_expense` | خیر | هزینه محقق‌شده؛ پیش‌فرض صفر |
| `currency` | خیر | پیش‌فرض `IRR` |
| `financial_note` | خیر | یادداشت کوتاه مالی فاز |

## ستون‌های حذف‌شده

ستون‌های زیر دیگر بخشی از قرارداد Excel نیستند و توسط واردکننده خوانده نمی‌شوند:

```text
owner_username
assigned_usernames
member_roles
member_started_at
member_expected_finished_at
phase_assigned_usernames
```

برای جلوگیری از برداشت اشتباه، این ستون‌ها باید از فایل‌های قبلی حذف شوند.

## تخصیص افراد بعد از ورود

مدیر بعد از ایجاد پروژه‌ها می‌تواند اطلاعات نیروی انسانی را در سامانه ثبت کند:

```http
PATCH /api/v1/projects/:id
POST  /api/v1/projects/:id/users
PATCH /api/v1/projects/:id/users/:userId
PATCH /api/v1/projects/:id/phases/:phaseId
```

ترتیب پیشنهادی:

1. تعیین `ownerId` در صفحه ویرایش پروژه.
2. افزودن اعضا و نقش هر عضو.
3. تعیین مسئولان هر فاز از میان کاربران سامانه.

## اعتبارسنجی

- حداکثر ۵۰۰ پروژه و ۲۵۰۰ فاز در هر فایل پردازش می‌شود.
- عنوان پروژه در فایل و دیتابیس نباید تکراری باشد.
- هیچ جست‌وجو یا اعتبارسنجی کاربر هنگام ورود Excel انجام نمی‌شود.
- تاریخ پایان پروژه یا فاز نمی‌تواند قبل از تاریخ شروع باشد.
- فاز باید داخل بازه زمانی پروژه قرار بگیرد.
- مبالغ مالی باید عدد مثبت یا صفر باشند.
- اگر یکی از فازهای یک پروژه خطا داشته باشد، همان پروژه وارد نمی‌شود تا داده ناقص ایجاد نشود.
- اگر ایجاد فازها شکست بخورد، پروژه ایجادشده نیز پاک می‌شود.

## پاسخ API

خروجی شامل تعداد ردیف‌های پروژه و فاز، تعداد موارد ایجادشده و خطاهای هر شیت است. پروژه‌ها و فازهای ایجادشده در وضعیت بدون تخصیص نیروی انسانی قرار دارند.

نمونه خلاصه پاسخ:

```json
{
  "success": true,
  "message": "2 پروژه و 5 فاز بدون تخصیص افراد از اکسل وارد شد.",
  "data": {
    "staffingMode": "post_import",
    "totalProjectRows": 2,
    "totalPhaseRows": 5,
    "createdCount": 2,
    "createdPhaseCount": 5,
    "skippedCount": 0,
    "failedCount": 0,
    "created": [
      {
        "id": "...",
        "title": "نمونه پروژه",
        "phaseCount": 2,
        "staffingRequired": true
      }
    ],
    "errors": []
  }
}
```

## فایل‌های مرتبط

```text
src/modules/projects/project-import.controller.ts
src/modules/projects/project.routes.ts
src/modules/projects/project.model.ts
src/docs/templates/project-import-template.xlsx
```
