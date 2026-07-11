# Project phases module

## Purpose

This backend keeps phase management inside the project module. The old standalone `project-finance` module and `/projects/:projectId/finance` routes remain removed.

Each project phase contains operational data plus a simple phase-level finance block:

- title
- description
- assigned users
- start date
- end date
- display order
- simple financial values:
  - expected revenue
  - expected expense
  - realized revenue
  - realized expense
  - short note

## Backend files

```txt
src/modules/projects/project.model.ts       # Project and ProjectPhase models
src/modules/projects/project.controller.ts  # Project CRUD, phase CRUD, simple phase finance
src/modules/projects/project.routes.ts      # Project and phase routes
```

## Phase API

```txt
GET    /api/v1/projects/:id/phases
POST   /api/v1/projects/:id/phases
GET    /api/v1/projects/:id/phases/:phaseId
PATCH  /api/v1/projects/:id/phases/:phaseId
PATCH  /api/v1/projects/:id/phases/:phaseId/financial
DELETE /api/v1/projects/:id/phases/:phaseId
```

## Kept deliberately simple

The phase financial section is not an invoice/accounting module. It only stores totals per phase, so management can see how much each phase was expected to earn/spend and how much it actually earned/spent.

## Removed backend finance items

```txt
src/modules/project-finance
/api/v1/projects/:projectId/finance
finance.* permissions
complicated invoice/settlement/approval flows
```

## Project creation behavior

Project creation accepts an optional `phases` array. Users assigned to phases are also added to the project members list automatically.

A user cannot be removed from a project if that user is still assigned to one of the project phases.

## ورود فازها همراه فایل Excel

ورود گروهی پروژه‌ها از شیت جداگانه `Phases` پشتیبانی می‌کند. هر ردیف فقط ساختار فاز، بازه زمانی و مالی ساده آن را تعریف می‌کند.

اطلاعات افراد و مسئولیت‌ها از Excel حذف شده است. فازهای واردشده با `assignedUserIds: []` ایجاد می‌شوند و مدیر پس از ورود، مسئولان هر فاز را در سامانه انتخاب می‌کند. این تصمیم وابستگی ورود Excel به username و وضعیت کاربران را حذف می‌کند.

جزئیات کامل ستون‌ها و قواعد اعتبارسنجی در فایل زیر قرار دارد:

```text
src/docs/project-excel-import.md
```
