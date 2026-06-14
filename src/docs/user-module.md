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
