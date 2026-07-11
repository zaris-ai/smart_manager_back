# Users Module

The users module now follows the simplified backend pattern:

```text
src/modules/users/
├── user.constants.ts
├── user.model.ts
├── user.controller.ts
├── user.validation.ts
└── user.routes.ts
```

There is no repository layer and no mapper layer.

- `user.model.ts` defines the Mongoose schema and TypeScript interfaces.
- `user.controller.ts` contains user CRUD, status changes, archive logic, and safe response shaping.
- `user.validation.ts` validates request payloads with Joi.
- `user.routes.ts` wires endpoints to controller functions.


## اتصال تلگرام کاربران

فیلدهای `telegramUserId`، `telegramChatId` و `telegramUsername` در پاسخ کاربر قابل مشاهده‌اند، اما در API عمومی ایجاد یا ویرایش کاربر قابل ثبت و تغییر نیستند. این مقادیر فقط از مسیر امن ربات نوشته می‌شوند:

1. مدیر از `POST /api/v1/telegram/users/:userId/link-code` کد یک‌بارمصرف می‌سازد.
2. کاربر `/link CODE` را در ربات ارسال می‌کند.
3. backend شناسه‌ها را از Telegram Update معتبر ذخیره می‌کند.
4. حذف اتصال فقط از `DELETE /api/v1/telegram/users/:userId/link` انجام می‌شود.

این محدودیت مانع ثبت دستی شناسه اشتباه یا اتصال یک حساب تلگرام به کاربر نامرتبط می‌شود.
