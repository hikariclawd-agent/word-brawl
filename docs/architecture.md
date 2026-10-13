# Architecture

## Shape

```txt
animal-name-place/
  apps/
    mobile/
  packages/
    game-core/
    shared/
  supabase/
    migrations/
    functions/
  docs/
```

## Rules

- Keep game logic in `packages/game-core`.
- Keep reusable types/constants in `packages/shared`.
- Keep screen code inside `apps/mobile`.
- Do not couple scoring rules to the database.
- Add Supabase only after the local game loop works.
- Use migration files for database changes.
- First schema migration lives at `supabase/migrations/20260627231500_initial_game_schema.sql`.
