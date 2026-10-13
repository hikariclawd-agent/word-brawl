/** Local/practice word choices: no model calls or access to a human's hidden answers. */
export function choosePersonalityWord(words: readonly string[], personality: string, random = Math.random): string {
  if (!words.length) return '';
  const sorted = [...words].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const width = Math.max(1, Math.ceil(sorted.length / 2));
  const pool = ['Careful', 'Speedy', 'Sloppy', 'Agreeable'].includes(personality)
    ? sorted.slice(0, width)
    : ['Scholar', 'Perfect', 'Aggressive', 'Skeptical'].includes(personality)
      ? sorted.slice(-width)
      : words;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

export type BotEvidenceVerdict = 'valid' | 'variant' | 'invalid' | 'blank';

export function judgeAnswerFromEvidence({
  answer,
  difficulty,
  knownInCurrentCategory,
  knownInOtherCategory,
  letter,
  scoringStyle,
}: {
  answer: string;
  difficulty: 'Easy' | 'Normal' | 'Hard';
  knownInCurrentCategory: boolean;
  knownInOtherCategory: boolean;
  letter: string;
  scoringStyle: 'Classic' | 'Strict';
}): BotEvidenceVerdict {
  const cleanAnswer = answer.trim();

  if (!cleanAnswer) {
    return 'blank';
  }

  if (scoringStyle === 'Strict' && letter && !cleanAnswer.toUpperCase().startsWith(letter)) {
    return 'invalid';
  }

  if (knownInOtherCategory && !knownInCurrentCategory) {
    return 'invalid';
  }

  if (cleanAnswer.length <= 2 || /[^a-z\s'-]/i.test(cleanAnswer)) {
    return difficulty === 'Hard' ? 'invalid' : 'variant';
  }

  if (knownInCurrentCategory) {
    return 'valid';
  }

  return difficulty === 'Easy' ? 'variant' : 'valid';
}
