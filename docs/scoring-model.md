# Word Brawl scoring model

## Canonical verdict and points contract

The approved contract is:

| Technical verdict | Player-facing outcome | Points |
| --- | --- | ---: |
| `valid` | Unique | 10 |
| `duplicate` | Shared | 5 |
| `variant` | Shared | 5 |
| `invalid` | No score | 0 |
| `blank` | No score | 0 |
| `disputed` | Pending review | No final points until resolved |

`variant` is not an automatic acceptance shortcut. It must still pass the
authoritative validation path; once the server has classified it as
`variant`, its player-facing outcome is Shared and its configured shared
points are applied.

For online matches, the server's persisted verdict and points are
authoritative at every boundary: answer review, round scores, dispute
resolution and final standings. A client-side verdict or local calculation
must not replace persisted online points.

## Player-facing outcomes

The game now presents only three outcomes:

| Outcome | Meaning | Default points |
| --- | --- | ---: |
| Unique | A valid answer nobody else gave | 10 |
| Shared | A valid answer another player also gave | 5 |
| No score | Blank, wrong, or rejected answer | 0 |

`valid`, `duplicate`, `variant`, `invalid`, and `blank` remain technical verdicts in stored data for moderation and migration safety. The table above is the contract for mapping them to the UI.

## Normalisation and duplicate detection

Display text and comparison keys are separate concerns:

- Display text preserves the submitted answer's original spelling, case,
  punctuation and diacritics. Trimming for a display label must not mutate the
  stored answer.
- The scoring/duplicate key trims the answer, applies the explicitly mapped
  Latin-character substitutions used by the server, removes all characters
  outside ASCII letters and digits (including spaces and punctuation), and
  lowercases the result.
- Blank answers are identified after comparison-key normalisation and are
  excluded from validation, duplicate groups and points.
- Duplicate comparison is scoped to the same category and round. It does not
  make an answer valid for the selected letter or category.
- CPU and human answers use the same authoritative validation and comparison
  rules. CPU answers are not privileged by their origin.

The client helper mirrors the migration source currently present in
`supabase/migrations/20261012144500_expand_african_latin_normalization.sql`.
This is source-level parity only: SQL tests have not run because Docker and
Supabase services are unavailable. Unicode characters outside that explicit
mapping remain unresolved and are not silently transliterated. The server
continues to own online validation, verdicts and points.

## Round summary

Show the player:

```text
Unique answers   4 × 10 = 40
Shared answers   2 × 5  = 10
No-score answers 1 × 0  = 0

Round score: 50
Total score: 130
```

## Rules

- Negative invalid-streak penalties are disabled in the canonical match rules.
- Scoring ownership is a system detail, not a player-facing rules choice.
- Technical verdicts may still be used internally for disputes and moderation.
- Server scoring is stored in `rooms.scoring_rules` using `unique`, `shared`, and `no_score` keys.
- Historical matches retain their ruleset version.

## Future modes

Change the scoring map or mode configuration, not the player vocabulary. For example, Blitz can use a shorter timer while keeping the same three outcomes.
