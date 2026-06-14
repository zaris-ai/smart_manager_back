# Auth Module

The auth module follows the simplified backend pattern:

```text
src/modules/auth/
├── auth.model.ts
├── auth.controller.ts
├── auth.middleware.ts
├── auth.routes.ts
├── auth.token.ts
└── auth.validation.ts
```

There is no repository layer.

- `auth.model.ts` defines the refresh-token Mongoose model and auth types.
- `auth.controller.ts` handles login, refresh, logout, logout-all, and current-user lookup.
- `auth.token.ts` handles JWT creation and verification.
- `auth.middleware.ts` protects private routes.
