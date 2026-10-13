alter table public.rooms
add column mode_label text not null default 'Custom',
add column mode_rules text not null default 'Set categories, CPUs, rounds, timer, and scoring before play.',
add column bot_count integer not null default 0,
add column bot_difficulty text not null default 'Normal',
add column categories text[] not null default array['Name', 'Place', 'Animal', 'Food', 'Object', 'Job', 'Brand'],
add column match_duration_seconds integer,
add column target_rounds integer not null default 3,
add column scoring_owner text not null default 'Opponents',
add column scoring_style text not null default 'Classic';

alter table public.rooms
add constraint rooms_bot_count_check check (bot_count between 0 and 4),
add constraint rooms_bot_difficulty_check check (bot_difficulty in ('Easy', 'Normal', 'Hard')),
add constraint rooms_categories_check check (array_length(categories, 1) between 1 and 7),
add constraint rooms_match_duration_seconds_check check (match_duration_seconds is null or match_duration_seconds between 60 and 1800),
add constraint rooms_target_rounds_check check (target_rounds between 1 and 999),
add constraint rooms_scoring_owner_check check (scoring_owner in ('Self', 'Opponents')),
add constraint rooms_scoring_style_check check (scoring_style in ('Classic', 'Strict'));
