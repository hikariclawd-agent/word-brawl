import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';
import { useCallback, useEffect } from 'react';

const tapSound = require('../assets/sounds/tap.mp3');
const startSound = require('../assets/sounds/start.mp3');
const submitSound = require('../assets/sounds/submit.mp3');
const revealSound = require('../assets/sounds/reveal.mp3');
const errorSound = require('../assets/sounds/error.mp3');
const wordGameMusicLoop = require('../assets/sounds/word-game-music.mp3');
const botDuelMusicLoop = require('../assets/sounds/bot-duel-music.mp3');
const marathonMusicLoop = require('../assets/sounds/marathon-music.mp3');

type UseGameAudioOptions = {
  activeModeLabel: string;
  musicOn: boolean;
  soundPack: string;
  soundFxOn: boolean;
};

export function useGameAudio({ activeModeLabel, musicOn, soundPack: _soundPack, soundFxOn }: UseGameAudioOptions) {
  const tapPlayer = useAudioPlayer(tapSound);
  const startPlayer = useAudioPlayer(startSound);
  const submitPlayer = useAudioPlayer(submitSound);
  const revealPlayer = useAudioPlayer(revealSound);
  const errorPlayer = useAudioPlayer(errorSound);
  const wordGameMusicPlayer = useAudioPlayer(wordGameMusicLoop);
  const botDuelMusicPlayer = useAudioPlayer(botDuelMusicLoop);
  const marathonMusicPlayer = useAudioPlayer(marathonMusicLoop);
  const modeMusicPlayer = activeModeLabel === 'Bot Duel'
    ? botDuelMusicPlayer
    : activeModeLabel === 'Marathon'
      ? marathonMusicPlayer
      : wordGameMusicPlayer;

  // Keep one short effect set loaded on web. Loading every sound-pack variant
  // up front made the first interaction and the first click feel delayed.
  const activePlayers = {
    reveal: revealPlayer,
    start: startPlayer,
    submit: submitPlayer,
    tap: tapPlayer,
  };

  useEffect(() => {
    try {
      setAudioModeAsync({
        playsInSilentMode: true,
      });
    } catch {
      // Audio should never block gameplay.
    }
  }, []);

  useEffect(() => {
    const musicPlayers = [wordGameMusicPlayer, botDuelMusicPlayer, marathonMusicPlayer];

    musicPlayers.forEach((player) => {
      player.loop = true;
      player.pause();
      try {
        player.seekTo(0);
      } catch {
        // Resetting audio is best-effort and must not block the lobby.
      }
    });

    if (musicOn && Platform.OS !== 'web') {
      try {
        modeMusicPlayer.play();
      } catch {
        // Browsers and some devices can block autoplay until a gesture.
      }
    }
  }, [activeModeLabel, botDuelMusicPlayer, marathonMusicPlayer, modeMusicPlayer, musicOn, wordGameMusicPlayer]);

  const playSound = useCallback((player: typeof tapPlayer) => {
    if (!soundFxOn) {
      return;
    }

    // Do not await seekTo before starting playback. On web that adds an
    // audible tick of latency to every button press.
    try {
      player.seekTo(0);
      player.play();
    } catch {
      // Ignore failed one-shot sounds. The game action still matters.
    }
  }, [soundFxOn]);

  return {
    playError: () => playSound(errorPlayer),
    playReveal: () => playSound(activePlayers.reveal),
    playStart: () => playSound(activePlayers.start),
    playSubmit: () => playSound(activePlayers.submit),
    playTap: () => playSound(activePlayers.tap),
  };
}
