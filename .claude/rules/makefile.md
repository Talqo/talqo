---
paths:
  - "**/{Makefile,makefile,GNUmakefile,*.mk}"
---

# Makefiles

## Targets and dependencies

- Use conventional developer targets such as `setup`, `test`, `lint`, and `build`. In new top-level developer Makefiles, default to a `help` target that lists targets marked with `##`.
- Declare which inputs each generated file depends on. Use order-only prerequisites for output directories. Express build order through prerequisites so `make -j` works from a clean tree.
- Keep recipes short and call the same commands developers and CI use. Use `$(MAKE)` for recursive builds so flags and parallelism carry through. Put steps that share shell state in a script.
- Honor command-line overrides for tools, paths, and build options. Propagate recipe failures and remove incomplete outputs so a retry rebuilds them.

## Side effects and verification

- Require an explicit destination or opt-in for deploy, publish, migration, and destructive recipes.
- Run changed targets that are safe to execute. For dependency changes, run a clean parallel build, rebuild without changes, then rebuild after changing an input. For shared `.mk` changes, test an existing consumer with an override.
- Review recipes before using `make -n` on targets with side effects. Recursive recipes and `$(shell ...)` calls can still execute.
