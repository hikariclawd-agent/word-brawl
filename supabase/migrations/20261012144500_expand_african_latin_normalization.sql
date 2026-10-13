-- Extend answer normalization for African Latin orthographies and other
-- extended Latin letters used in names and places. This keeps validation
-- category-specific while preventing accented spellings such as Ola/Ola,
-- Segun/Segun, and N'Djamena/Ndjamena from splitting into different keys.

create or replace function public.normalize_live_brawl_answer(p_answer_text text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(
    replace(replace(replace(replace(replace(replace(
      translate(
        trim(coalesce(p_answer_text, '')),
        'ÀÁÂÃÄÅĀĂĄàáâãäåāăąẠạḄḅƁɓÇĆĈĊČçćĉċčÐĎĐðďđƊɗÈÉÊËĒĔĖĘĚèéêëēĕėęěẸẹƐɛƑƒƓɠḤḥÌÍÎÏĨĪĬĮİìíîïĩīĭįıỊịƘƙṂṃÑŃŅŇñńņňṄṅṆṇÒÓÔÕÖØŌŎŐòóôõöøōŏőỌọƆɔŔŖŘŕŗřŚŜŞŠśŝşšṢṣÙÚÛÜŨŪŬŮŰŲùúûüũūŭůűųỤụÝŶŸýÿŷỴỵƳƴŹŻŽźżžŁłÞþṬṭ',
        'AAAAAAAAAaaaaaaaaaAaBBBbCCCCCcccccDDDdddDdEEEEEEEEEeeeeeeeeeEeEeFfGgHhIIIIIIIIIiiiiiiiiiIiKkMmNNNNnnnnNnNnOOOOOOOOOoooooooooOoOoRRRrrrSSSSssssSsUUUUUUUUUUuuuuuuuuuuUuYYYyyyYyYyZZZzzzLlTtTt'
      ),
      'Æ', 'AE'),
      'æ', 'ae'),
      'Œ', 'OE'),
      'œ', 'oe'),
      'ß', 'ss'),
      'ẞ', 'SS'
    ),
    '[^a-zA-Z0-9]+',
    '',
    'g'
  ));
$$;

grant execute on function public.normalize_live_brawl_answer(text) to anon, authenticated;
