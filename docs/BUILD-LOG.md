# Build log

- Step 1: Added the TypeScript/pnpm repo scaffold, lockfile, lint/test scripts, env template, MIT license, and README skeleton; validated the manifest and required files. Initial install was blocked by pnpm's build policy; resolved in step 0. Commit: `chore: scaffold Backlog project`.
- Step 0: Allowed the esbuild install script (pnpm 11 uses `allowBuilds` in `pnpm-workspace.yaml`; the requested package field is retained) and installed dependencies. `pnpm lint` passed; `pnpm test` passed with 0 tests before feature work. Commit: `build: allow esbuild install script`.
