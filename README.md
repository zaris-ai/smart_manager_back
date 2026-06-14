# Avid Backend Service

Backend service for the Avid smart task/admin panel.

This version uses a simple module structure:

```text
src/modules/<module>/
├── <module>.model.ts
├── <module>.controller.ts
├── <module>.routes.ts
└── <module>.validation.ts   # only when request validation is needed
```

The project intentionally does not use repository, mapper, or bootstrap layers.
Models are Mongoose schemas, controllers contain the module logic, and routes only wire endpoints to controllers.

## Stack

- Node.js
- TypeScript
- Express
- MongoDB
- Mongoose
- Joi validation
- JWT authentication
- Multer file upload

## Main routes

```text
/api/v1/health
/api/v1/auth
/api/v1/users
/api/v1/projects
/api/v1/uploads
```

## Projects module

```text
src/modules/projects/
├── project.model.ts
├── project.controller.ts
└── project.routes.ts
```

Project features:

- Create, list, update, and archive projects
- Assign users to projects
- Create and manage project tasks
- Add project progress notes
- Upload project files
- Return calendar events from project and task dates

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run typecheck
npm run build
```
