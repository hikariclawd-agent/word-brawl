#!/usr/bin/env node

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

const CATEGORY_SEEDS = {
  Animal: ['animal', 'mammal', 'bird', 'fish'],
  Food: ['food', 'meal', 'fruit', 'vegetable'],
  Job: ['profession', 'occupation', 'job'],
  Object: ['object', 'tool', 'instrument'],
  Place: ['city', 'country', 'place'],
};

function normalizeWord(word) {
  return word.trim().toUpperCase().replace(/\s+/g, ' ');
}

function isUsefulWord(word) {
  return /^[a-z][a-z '-]{1,38}$/i.test(word) && !word.includes('_');
}

async function fetchDatamuseWords(seed) {
  const url = new URL('https://api.datamuse.com/words');
  url.searchParams.set('ml', seed);
  url.searchParams.set('md', 'p');
  url.searchParams.set('max', '120');

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Datamuse failed for ${seed}: ${response.status}`);
  }

  return response.json();
}

async function upsertWordEntries(rows) {
  if (!rows.length) {
    return;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/word_entries?on_conflict=category,normalized_word`, {
    body: JSON.stringify(rows),
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Supabase upsert failed: ${response.status} ${await response.text()}`);
  }
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY first.');
  }

  let total = 0;

  for (const [category, seeds] of Object.entries(CATEGORY_SEEDS)) {
    const rowsByWord = new Map();

    for (const seed of seeds) {
      const words = await fetchDatamuseWords(seed);

      words
        .filter((entry) => typeof entry.word === 'string' && isUsefulWord(entry.word))
        .forEach((entry) => {
          const normalizedWord = normalizeWord(entry.word);

          rowsByWord.set(`${category}:${normalizedWord}`, {
            category,
            normalized_word: normalizedWord,
            source: `datamuse:${seed}`,
            status: 'candidate',
            word: entry.word.trim(),
          });
        });
    }

    const rows = [...rowsByWord.values()];
    await upsertWordEntries(rows);
    total += rows.length;
    console.log(`${category}: ${rows.length} candidates`);
  }

  console.log(`Imported ${total} Datamuse candidate words.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
