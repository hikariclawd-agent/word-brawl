import { normalizeAnswer, scoreAnswer, type AnswerVerdict } from '@animal-name-place/game-core';
import { STARTER_CATEGORIES, type StarterCategory } from '@animal-name-place/shared';
import { choosePersonalityWord } from './botStrategy';

export type BotDifficulty = 'Easy' | 'Normal' | 'Hard';
export type BotPersonality =
  | 'Aggressive'
  | 'Agreeable'
  | 'Careful'
  | 'Chaotic'
  | 'Generous'
  | 'Perfect'
  | 'Scholar'
  | 'Skeptical'
  | 'Sloppy'
  | 'Speedy';
export type BotRoundAnswer = {
  answer: string;
  botId: string;
  botName: string;
  category: StarterCategory;
  points: number;
  verdict: AnswerVerdict;
};
export type AnswersByCategory = Record<StarterCategory, string>;

const BOT_DIFFICULTY_PROFILE: Record<BotDifficulty, { fillRate: number; typoRate: number; validRate: number }> = {
  Easy: { fillRate: 0.55, typoRate: 0.28, validRate: 0.58 },
  Normal: { fillRate: 0.82, typoRate: 0.1, validRate: 0.84 },
  Hard: { fillRate: 1, typoRate: 0.01, validRate: 0.97 },
};

const BOT_PERSONALITY_PROFILE: Record<BotPersonality, {
  challengeRateMultiplier: number;
  fillRateBoost: number;
  typoRateMultiplier: number;
  validRateBoost: number;
}> = {
  Aggressive: { challengeRateMultiplier: 1.7, fillRateBoost: 0.04, typoRateMultiplier: 0.8, validRateBoost: 0.02 },
  Agreeable: { challengeRateMultiplier: 0.35, fillRateBoost: 0, typoRateMultiplier: 0.9, validRateBoost: 0.03 },
  Careful: { challengeRateMultiplier: 1.05, fillRateBoost: -0.02, typoRateMultiplier: 0.35, validRateBoost: 0.12 },
  Chaotic: { challengeRateMultiplier: 1, fillRateBoost: -0.02, typoRateMultiplier: 1.8, validRateBoost: -0.08 },
  Generous: { challengeRateMultiplier: 0.25, fillRateBoost: 0, typoRateMultiplier: 0.9, validRateBoost: 0.07 },
  Sloppy: { challengeRateMultiplier: 0.85, fillRateBoost: -0.05, typoRateMultiplier: 2.6, validRateBoost: -0.14 },
  Perfect: { challengeRateMultiplier: 1.15, fillRateBoost: 0.08, typoRateMultiplier: 0, validRateBoost: 0.2 },
  Scholar: { challengeRateMultiplier: 1.25, fillRateBoost: 0.06, typoRateMultiplier: 0.2, validRateBoost: 0.16 },
  Skeptical: { challengeRateMultiplier: 1.45, fillRateBoost: 0.02, typoRateMultiplier: 0.7, validRateBoost: -0.03 },
  Speedy: { challengeRateMultiplier: 0.75, fillRateBoost: 0.1, typoRateMultiplier: 1.4, validRateBoost: -0.02 },
};

const BOT_WORD_BANK: Record<StarterCategory, string[]> = {
  Animal: [
    'Antelope', 'Bear', 'Cat', 'Dog', 'Eagle', 'Falcon', 'Goat', 'Horse', 'Iguana', 'Jaguar',
    'Koala', 'Lion', 'Monkey', 'Newt', 'Otter', 'Panda', 'Quail', 'Rabbit', 'Snake', 'Tiger',
    'Urial', 'Viper', 'Wolf', 'Xerus', 'Yak', 'Zebra',
    'Aardvark', 'Buffalo', 'Cheetah', 'Dolphin', 'Elephant', 'Fox', 'Giraffe', 'Hyena', 'Impala', 'Jackal',
    'Kangaroo', 'Leopard', 'Mongoose', 'Narwhal', 'Ostrich', 'Penguin', 'Quokka', 'Rhino', 'Shark', 'Tortoise',
    'Uakari', 'Vulture', 'Whale', 'Xenops', 'Yellowhammer', 'Zebu',
    'Alpaca', 'Baboon', 'Camel', 'Deer', 'Emu', 'Ferret', 'Gazelle', 'Hedgehog', 'Ibex', 'Jellyfish',
    'Kingfisher', 'Lemur', 'Meerkat', 'Numbat', 'Octopus', 'Peacock', 'Quetzal', 'Raccoon', 'Seal', 'Toucan',
    'Urchin', 'Vicuna', 'Walrus', 'Xolo', 'Yabby', 'Zorilla',
  ],
  Name: [
    'Alex', 'Bella', 'Caleb', 'Diana', 'Ethan', 'Fatima', 'Grace', 'Hassan', 'Isaac', 'Jade',
    'Kofi', 'Lola', 'Maya', 'Nadia', 'Omar', 'Peter', 'Queenie', 'Rita', 'Samuel', 'Tunde',
    'Uche', 'Victor', 'Wendy', 'Xavier', 'Yara', 'Zara',
    'Amina', 'Brian', 'Chika', 'Daniel', 'Esther', 'Femi', 'Gloria', 'Hannah', 'Ibrahim', 'James',
    'Kwame', 'Linda', 'Michael', 'Nana', 'Olivia', 'Priya', 'Quincy', 'Rachel', 'Sarah', 'Theo',
    'Uma', 'Vanessa', 'William', 'Ximena', 'Yusuf', 'Zainab',
    'Ada', 'Bola', 'Chioma', 'David', 'Ebere', 'Freya', 'George', 'Helen', 'Ife', 'Jonah',
    'Keisha', 'Luke', 'Malik', 'Naomi', 'Oscar', 'Paula', 'Quinn', 'Ruth', 'Sade', 'Tariq',
    'Uriel', 'Vera', 'Wale', 'Xena', 'Yemi', 'Zion', 'Joe',
  ],
  Place: [
    'Accra', 'Berlin', 'Cairo', 'Durban', 'Enugu', 'Florence', 'Ghana', 'Harare', 'Ibadan', 'Jakarta',
    'Kano', 'Lagos', 'Madrid', 'Nairobi', 'Oslo', 'Paris', 'Qatar', 'Rome', 'Seoul', 'Tokyo',
    'Uyo', 'Vienna', 'Warsaw', 'Xian', 'Yaounde', 'Zurich',
    'Abuja', 'Bradford', 'Cape Town', 'Dakar', 'Edinburgh', 'Freetown', 'Geneva', 'Houston', 'Istanbul', 'Johannesburg',
    'Kigali', 'London', 'Manchester', 'Naples', 'Oxford', 'Pretoria', 'Quebec', 'Rotterdam', 'Sydney', 'Toronto',
    'Uganda', 'Venice', 'Wembley', 'Xiamen', 'York', 'Zambia',
    'Athens', 'Bristol', 'Chicago', 'Delhi', 'Edo', 'Frankfurt', 'Gaborone', 'Helsinki', 'Ilorin', 'Kaduna',
    'Kyoto', 'Lisbon', 'Milan', 'New York', 'Orlando', 'Porto', 'Queens', 'Rwanda', 'Stockholm', 'Tripoli',
    'Utrecht', 'Valencia', 'Winnipeg', 'Xalapa', 'Yokohama', 'Zimbabwe',
  ],
  Brand: [
    'Apple', 'Bose', 'Canon', 'Disney', 'Ebay', 'Fanta', 'Google', 'Honda', 'Intel', 'Jeep',
    'Kia', 'Lego', 'Meta', 'Nike', 'Oppo', 'Pepsi', 'Quaker', 'Rolex', 'Samsung', 'Toyota',
    'Uber', 'Visa', 'Walmart', 'Xbox', 'Yamaha', 'Zara',
    'Adidas', 'Burger King', 'Coca Cola', 'Dell', 'Emirates', 'Ford', 'Gucci', 'HP', 'Instagram', 'Jordan',
    'KFC', 'LinkedIn', 'Mercedes', 'Netflix', 'Oracle', 'PlayStation', 'Qantas', 'Red Bull', 'Spotify', 'Tesla',
    'Under Armour', 'Vans', 'WhatsApp', 'Xiaomi', 'YouTube', 'Zoom',
    'Acer', 'Balenciaga', 'Cadbury', 'Dominos', 'Etsy', 'Fila', 'Glo', 'Huawei', 'Ikea', 'Jumia',
    'Kodak', 'Lacoste', 'Microsoft', 'Nvidia', 'Olympus', 'Prada', 'Qualcomm', 'Reebok', 'Shell', 'TikTok',
    'Unilever', 'Virgin', 'WordPress', 'Xfinity', 'Yelp', 'Zalando',
  ],
  Food: [
    'Apple', 'Bread', 'Cake', 'Donut', 'Egg', 'Fish', 'Gari', 'Honey', 'Icecream', 'Jollof',
    'Kebab', 'Lemon', 'Mango', 'Noodles', 'Okra', 'Pizza', 'Quiche', 'Rice', 'Soup', 'Taco',
    'Udon', 'Vanilla', 'Waffles', 'Xigua', 'Yam', 'Ziti',
    'Avocado', 'Beans', 'Chicken', 'Dumpling', 'Egusi', 'Falafel', 'Granola', 'Hotdog', 'Indomie', 'Jambalaya',
    'Kiwi', 'Lasagne', 'Moi Moi', 'Nachos', 'Oats', 'Pasta', 'Quesadilla', 'Ramen', 'Salad', 'Toast',
    'Ugba', 'Vegetables', 'Watermelon', 'Xacuti', 'Yoghurt', 'Zucchini',
    'Akara', 'Burger', 'Couscous', 'Dates', 'Eba', 'Fries', 'Grapes', 'Hummus', 'Idli', 'Jam',
    'Kale', 'Lentils', 'Meatballs', 'Nutmeg', 'Orange', 'Plantain', 'Quinoa', 'Risotto', 'Stew', 'Tuna',
    'Ukwa', 'Vindaloo', 'Wrap', 'Xnipec', 'Yassa', 'Zobo',
  ],
  Job: [
    'Artist', 'Baker', 'Chef', 'Doctor', 'Engineer', 'Farmer', 'Guard', 'Host', 'Inspector', 'Judge',
    'Keeper', 'Lawyer', 'Mechanic', 'Nurse', 'Officer', 'Pilot', 'Quartermaster', 'Ranger', 'Singer', 'Teacher',
    'Umpire', 'Vendor', 'Writer', 'Xylophonist', 'Youtuber', 'Zookeeper',
    'Accountant', 'Barber', 'Carpenter', 'Dentist', 'Electrician', 'Firefighter', 'Guide', 'Hairdresser', 'Illustrator', 'Journalist',
    'Knight', 'Lecturer', 'Manager', 'Nutritionist', 'Optician', 'Producer', 'Quality Inspector', 'Receptionist', 'Scientist', 'Tailor',
    'Usher', 'Vet', 'Waiter', 'Xray Technician', 'Yoga Instructor', 'Zoologist',
    'Actor', 'Banker', 'Courier', 'Designer', 'Editor', 'Florist', 'Geologist', 'Historian', 'Importer', 'Janitor',
    'Keyholder', 'Librarian', 'Musician', 'Novelist', 'Operator', 'Photographer', 'Quantity Surveyor', 'Researcher', 'Surgeon', 'Translator',
    'Undertaker', 'Videographer', 'Welder', 'Xray Operator', 'Youth Worker', 'Zumba Instructor',
  ],
  Object: [
    'Apple', 'Book', 'Chair', 'Drum', 'Envelope', 'Fork', 'Guitar', 'Hammer', 'Ink', 'Jacket',
    'Kettle', 'Lamp', 'Mirror', 'Notebook', 'Orange', 'Phone', 'Quilt', 'Radio', 'Spoon', 'Table',
    'Umbrella', 'Violin', 'Wallet', 'Xbox', 'Yarn', 'Zip',
    'Anchor', 'Bottle', 'Camera', 'Door', 'Eraser', 'Flag', 'Glasses', 'Helmet', 'Iron', 'Jar',
    'Key', 'Laptop', 'Microphone', 'Needle', 'Oven', 'Pencil', 'Queue Ticket', 'Remote', 'Suitcase', 'Torch',
    'Uniform', 'Vase', 'Watch', 'Xylophone', 'Yo-yo', 'Zipper',
    'Arrow', 'Basket', 'Candle', 'Desk', 'Earphones', 'Fan', 'Globe', 'Hat', 'Icebox', 'Jug',
    'Knife', 'Ladder', 'Mug', 'Net', 'Oil Lamp', 'Plate', 'Quartz', 'Ring', 'Scissors', 'Towel',
    'USB', 'Vacuum', 'Whistle', 'Xerox', 'Yoyo', 'Ziplock',
  ],
};

function pickBotAnswer(category: StarterCategory, letter: string, personality: BotPersonality) {
  const options = BOT_WORD_BANK[category].filter((word) => word.toUpperCase().startsWith(letter));
  return options.length ? choosePersonalityWord(options, personality) : '';
}

export function getKnownCategoriesForAnswer(answer: string) {
  const normalizedAnswer = normalizeAnswer(answer);
  if (!normalizedAnswer) return [] as StarterCategory[];

  return STARTER_CATEGORIES.filter((category) => (
    BOT_WORD_BANK[category].some((word) => normalizeAnswer(word) === normalizedAnswer)
  ));
}

export function findMatchingBotAnswer(
  answer: string,
  category: StarterCategory,
  botAnswers: readonly BotRoundAnswer[],
): BotRoundAnswer | undefined {
  const normalizedAnswer = normalizeAnswer(answer);
  if (!normalizedAnswer) return undefined;

  return botAnswers.find((botAnswer) => (
    botAnswer.category === category
    && Boolean(normalizeAnswer(botAnswer.answer))
    && normalizeAnswer(botAnswer.answer) === normalizedAnswer
  ));
}

function createTypo(answer: string) {
  if (answer.length < 4) return `${answer}${answer.at(-1) ?? ''}`;

  const typoIndex = Math.max(1, Math.floor(Math.random() * answer.length));
  const typoType = Math.floor(Math.random() * 3);
  if (typoType === 0) return `${answer.slice(0, typoIndex)}${answer.slice(typoIndex + 1)}`;
  if (typoType === 1) return `${answer.slice(0, typoIndex)}${answer[typoIndex]}${answer.slice(typoIndex)}`;
  if (typoIndex >= answer.length - 1) return `${answer}${answer.at(-1) ?? ''}`;
  return `${answer.slice(0, typoIndex)}${answer[typoIndex + 1]}${answer[typoIndex]}${answer.slice(typoIndex + 2)}`;
}

function clampRate(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function createBotRoundAnswers(
  botCount: number,
  botNames: readonly string[],
  botPersonalities: readonly BotPersonality[],
  categories: readonly StarterCategory[],
  difficulty: BotDifficulty,
  letter: string,
): BotRoundAnswer[] {
  const profile = BOT_DIFFICULTY_PROFILE[difficulty];

  return Array.from({ length: botCount }).flatMap((_, botIndex) => (
    categories.map((category) => {
      const botId = `bot-${botIndex + 1}`;
      const botName = botNames[botIndex] ?? `CPU ${botIndex + 1}`;
      const personalityProfile = BOT_PERSONALITY_PROFILE[botPersonalities[botIndex] ?? 'Agreeable'];
      const fillRate = clampRate(profile.fillRate + personalityProfile.fillRateBoost);
      const typoRate = clampRate(profile.typoRate * personalityProfile.typoRateMultiplier);

      if (Math.random() > fillRate) {
        return { answer: '', botId, botName, category, points: 0, verdict: 'blank' as const };
      }

      const cleanAnswer = pickBotAnswer(category, letter, botPersonalities[botIndex] ?? 'Agreeable');
      const hasTypo = Boolean(cleanAnswer) && Math.random() <= typoRate;
      const answer = hasTypo ? createTypo(cleanAnswer) : cleanAnswer;
      const verdict: AnswerVerdict = 'blank';
      return { answer, botId, botName, category, points: scoreAnswer({ verdict }), verdict };
    })
  ));
}

export function markDuplicateBotAnswers(
  botAnswers: readonly BotRoundAnswer[],
  playerAnswers: AnswersByCategory,
  categories: readonly StarterCategory[],
) {
  const duplicateKeys = new Set<string>();

  categories.forEach((category) => {
    const answerGroups = new Map<string, string[]>();
    const playerAnswer = normalizeAnswer(playerAnswers[category]);
    if (playerAnswer) answerGroups.set(playerAnswer, ['player']);

    botAnswers
      .filter((botAnswer) => botAnswer.category === category && botAnswer.answer.trim())
      .forEach((botAnswer) => {
        const normalizedAnswer = normalizeAnswer(botAnswer.answer);
        const key = `${botAnswer.botId}:${category}`;
        answerGroups.set(normalizedAnswer, [...(answerGroups.get(normalizedAnswer) ?? []), key]);
      });

    answerGroups.forEach((owners) => {
      if (owners.length > 1) owners.filter((owner) => owner !== 'player').forEach((owner) => duplicateKeys.add(owner));
    });
  });

  return botAnswers.map((botAnswer) => {
    if (!duplicateKeys.has(`${botAnswer.botId}:${botAnswer.category}`)) return botAnswer;
    return { ...botAnswer, points: scoreAnswer({ verdict: 'duplicate' }), verdict: 'duplicate' as const };
  });
}

export function scoreBotOwnAnswers(
  botAnswers: readonly BotRoundAnswer[],
  letter: string,
  scoringStyle: 'Classic' | 'Strict',
) {
  return botAnswers.map((botAnswer) => {
    const answer = botAnswer.answer.trim();
    if (!answer || botAnswer.verdict !== 'blank') return botAnswer;

    let verdict: AnswerVerdict = 'variant';
    if (scoringStyle === 'Strict' && letter && !answer.toUpperCase().startsWith(letter)) {
      verdict = 'invalid';
    } else if (getKnownCategoriesForAnswer(answer).includes(botAnswer.category)) {
      verdict = 'valid';
    }

    return { ...botAnswer, points: scoreAnswer({ verdict }), verdict };
  });
}

export function scoreBotRoundAnswers(botCount: number, answers: readonly BotRoundAnswer[]) {
  return Array.from({ length: botCount }, (_, botIndex) => {
    const botId = `bot-${botIndex + 1}`;
    return answers.filter((answer) => answer.botId === botId).reduce((total, answer) => total + answer.points, 0);
  });
}
