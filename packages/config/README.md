# @shkriuss/config

Shared configuration for every package and app in the monorepo.

| File                 | Use it for                                                              |
| -------------------- | ----------------------------------------------------------------------- |
| `tsconfig/base.json` | Strictest TypeScript settings; code that is bundled (Vite) or type-only |
| `tsconfig/app.json`  | Browser apps: `base.json` plus the DOM and React's JSX                  |
| `tsconfig/node.json` | Scripts that Node.js runs directly as `.ts` (native type stripping)     |

Extend one of them from a package's `tsconfig.json`:

```json
{ "extends": "@shkriuss/config/tsconfig/node.json", "include": ["src"] }
```

Relative imports always include the file extension (`./file.ts`), so the same source works in Node.js, Vite and Vitest.
