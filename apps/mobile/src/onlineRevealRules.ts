export type OnlineCompetitivePlayer = {
  display_name?: string;
  id: string;
  role: 'player' | 'spectator';
};

export function getCompetitivePlayers<T extends OnlineCompetitivePlayer>(players: readonly T[]): T[] {
  return players.filter((player) => player.role === 'player');
}
