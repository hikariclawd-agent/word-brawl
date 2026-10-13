# Word Brawl scoring model

## Player-facing outcomes

The game now presents only three outcomes:

| Outcome | Meaning | Default points |
| --- | --- | ---: |
| Unique | A valid answer nobody else gave | 10 |
| Shared | A valid answer another player also gave | 5 |
| No score | Blank, wrong, or rejected answer | 0 |

`valid`, `duplicate`, `variant`, `invalid`, and `blank` remain technical verdicts in stored data for moderation and migration safety. They should not be the primary language in the game UI.

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
