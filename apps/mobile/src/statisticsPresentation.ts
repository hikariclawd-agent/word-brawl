export type BotAnswerForStatistics = {
  answer: string;
  botId: string;
};

export function countAnsweredBotAnswers(
  answers: readonly BotAnswerForStatistics[],
  botId: string,
) {
  return answers.filter((answer) => answer.botId === botId && answer.answer.trim()).length;
}
