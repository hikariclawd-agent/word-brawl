import { type StarterCategory } from '@animal-name-place/shared';
import { type AnswerVerdict } from '@animal-name-place/game-core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const WORD_BANK_CACHE_KEY = 'animal-name-place/word-bank-cache/v1';
const WORD_BANK_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type CachedWordBank = Partial<Record<StarterCategory, string[]>>;
export type CachedWordSuggestion = {
  category: StarterCategory;
  distance: number;
  word: string;
};
type CachedWordBankPayload = {
  bank: CachedWordBank;
  syncedAt: number;
};
type WordEntryRow = {
  category: string;
  normalized_word: string;
  word: string;
};
export type ServerWordValidationResult = {
  source: string;
  verdict: AnswerVerdict;
};

export function normalizeWordEntry(word: string) {
  return word.trim().toUpperCase().replace(/\s+/g, ' ');
}

function getEditDistance(left: string, right: string) {
  const previousRow = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const currentRow = [leftIndex];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;

      currentRow[rightIndex] = Math.min(
        currentRow[rightIndex - 1] + 1,
        previousRow[rightIndex] + 1,
        previousRow[rightIndex - 1] + substitutionCost,
      );
    }

    previousRow.splice(0, previousRow.length, ...currentRow);
  }

  return previousRow[right.length];
}

function getSuggestionDistanceLimit(word: string) {
  if (word.length <= 4) {
    return 1;
  }

  if (word.length <= 8) {
    return 2;
  }

  return 3;
}

function addWordToBank(bank: CachedWordBank, category: StarterCategory, word: string) {
  const normalizedWord = normalizeWordEntry(word);

  if (!normalizedWord) {
    return bank;
  }

  const currentWords = bank[category] ?? [];

  if (currentWords.includes(normalizedWord)) {
    return bank;
  }

  return {
    ...bank,
    [category]: [...currentWords, normalizedWord].sort(),
  };
}

function rowsToBank(rows: readonly WordEntryRow[]) {
  return rows.reduce<CachedWordBank>((bank, row) => (
    addWordToBank(bank, row.category as StarterCategory, row.normalized_word || row.word)
  ), {});
}

function isCachedWordBankPayload(value: unknown): value is CachedWordBankPayload {
  return Boolean(
    value
    && typeof value === 'object'
    && 'bank' in value
    && 'syncedAt' in value
  );
}

function parseStoredWordBank(storedCache: string | null) {
  if (!storedCache) {
    return {
      bank: {},
      syncedAt: 0,
    };
  }

  const parsedCache = JSON.parse(storedCache) as CachedWordBank | CachedWordBankPayload;

  if (isCachedWordBankPayload(parsedCache)) {
    return {
      bank: parsedCache.bank,
      syncedAt: parsedCache.syncedAt,
    };
  }

  return {
    bank: parsedCache,
    syncedAt: 0,
  };
}

function writeCachedWordBank(bank: CachedWordBank, syncedAt = Date.now()) {
  const payload: CachedWordBankPayload = {
    bank,
    syncedAt,
  };

  return AsyncStorage.setItem(WORD_BANK_CACHE_KEY, JSON.stringify(payload));
}

export async function loadCachedWordBank() {
  try {
    const storedCache = await AsyncStorage.getItem(WORD_BANK_CACHE_KEY);

    return parseStoredWordBank(storedCache).bank;
  } catch {
    return {};
  }
}

export async function shouldSyncWordBankCache() {
  try {
    const storedCache = await AsyncStorage.getItem(WORD_BANK_CACHE_KEY);
    const cached = parseStoredWordBank(storedCache);

    return Date.now() - cached.syncedAt > WORD_BANK_CACHE_MAX_AGE_MS;
  } catch {
    return true;
  }
}

export async function syncWordBankCache() {
  const { data, error } = await supabase
    .from('word_entries')
    .select('category, normalized_word, word')
    .eq('status', 'accepted')
    .order('category', { ascending: true })
    .limit(5000);

  if (error) {
    return loadCachedWordBank();
  }

  const nextBank = rowsToBank((data ?? []) as WordEntryRow[]);
  await writeCachedWordBank(nextBank).catch(() => undefined);
  return nextBank;
}

export async function checkServerWordValidation(
  category: StarterCategory,
  answer: string,
  letter: string,
): Promise<ServerWordValidationResult> {
  const { data, error } = await supabase.rpc('validate_live_brawl_answer', {
    p_answer_text: answer,
    p_category: category,
    p_letter: letter.toUpperCase(),
  });

  if (error) {
    throw error;
  }

  return {
    source: 'Supabase validation cache',
    verdict: data as AnswerVerdict,
  };
}

export function isCachedWordAccepted(bank: CachedWordBank, category: StarterCategory, word: string) {
  const normalizedWord = normalizeWordEntry(word);

  return Boolean(normalizedWord && bank[category]?.includes(normalizedWord));
}

export function getCachedWordSuggestions(
  bank: CachedWordBank,
  category: StarterCategory,
  word: string,
  limit = 4,
) {
  const normalizedWord = normalizeWordEntry(word);

  if (!normalizedWord) {
    return [];
  }

  const distanceLimit = getSuggestionDistanceLimit(normalizedWord);
  const suggestions = Object.entries(bank).flatMap(([entryCategory, words]) => (
    (words ?? []).map((entryWord) => ({
      category: entryCategory as StarterCategory,
      distance: getEditDistance(normalizedWord, entryWord),
      word: entryWord,
    }))
  ))
    .filter((suggestion) => suggestion.word !== normalizedWord && suggestion.distance <= distanceLimit)
    .sort((left, right) => {
      const leftCategoryScore = left.category === category ? 0 : 1;
      const rightCategoryScore = right.category === category ? 0 : 1;

      return leftCategoryScore - rightCategoryScore
        || left.distance - right.distance
        || left.word.localeCompare(right.word);
    });

  return suggestions.slice(0, limit);
}

export async function rememberAcceptedWord(
  bank: CachedWordBank,
  category: StarterCategory,
  word: string,
  source = 'player-score',
) {
  const normalizedWord = normalizeWordEntry(word);

  if (!normalizedWord) {
    return bank;
  }

  const nextBank = addWordToBank(bank, category, normalizedWord);
  await writeCachedWordBank(nextBank).catch(() => undefined);

  void Promise.resolve(
    supabase
      .from('word_entries')
      .upsert({
        category,
        last_seen_at: new Date().toISOString(),
        normalized_word: normalizedWord,
        source,
        status: 'accepted',
        word: word.trim(),
      }, {
        onConflict: 'category,normalized_word',
      }),
  ).catch(() => undefined);

  return nextBank;
}
