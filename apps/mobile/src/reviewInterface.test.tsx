/// <reference types="node" />
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Pressable: 'button', ScrollView: 'scroll', Text: 'text', View: 'view', StyleSheet: { create: (s: unknown) => s } }));
vi.mock('lucide-react-native', () => ({ Check: 'check', ChevronDown: 'down', ChevronRight: 'right', ChevronUp: 'up', CircleHelp: 'help', Minus: 'minus', UserRound: 'user', X: 'x' }));
import { AnswerDetails, AnswerRow, ReviewSummary, type ReviewAnswer } from './components/ReviewComponents';
import { buildReviewCategoryDeck as buildReviewCategoryDeckProjection, resolveReviewSelection, reviewResolution, reviewDetailsVisible } from './reviewPresentation';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as components from './components/ReviewComponents';
// Expand actual presentation components without installing a native renderer.
function expand(node: any): any {
  if (Array.isArray(node)) return node.map(expand);
  if (!React.isValidElement(node)) return node;
  const el = node as React.ReactElement<any>;
  if (typeof el.type === 'function') return expand((el.type as any)(el.props));
  return { type: el.type, props: el.props, children: expand(el.props.children) };
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (node == null || typeof node === 'boolean') return '';
  return typeof node === 'object' ? text(node.children) : String(node);
}
const shared: ReviewAnswer = { id: 'self', onlineAnswerId: 'server-self', answer: 'Alice', category: 'Name', label: 'You', points: 5, status: 'variant', resolution: 'resolved', isNoAnswer: false };
// Execute the actual App render function, with native hosts and game inputs mocked.
// This catches wiring regressions; it is not a browser pointer/focus test.
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
function appRenderer(source: string, scope: Record<string, any>) {
  const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function('scope', 'with(scope) { ' + js + '; return render; }')(scope);
}
function buildReviewCategoryDeck(scope: Record<string, any>) {
  return buildReviewCategoryDeckProjection({
    answers: scope.answers,
    assignedBotScoringTargetId: scope.assignedBotScoringTargetId,
    assignedHumanScoringTargetId: scope.assignedHumanScoringTargetId,
    botRoundAnswers: scope.botRoundAnswers,
    disputedBotAnswers: scope.disputedBotAnswers,
    disputedCategories: scope.disputedCategories,
    isOnline: Boolean(scope.room?.isOnline),
    laneColor: scope.laneColor,
    onlineRevealAnswers: scope.onlineRevealAnswers,
    playerId: scope.room?.playerId,
    scoreAnswer: scope.scoreAnswer,
    selectedCategories: scope.selectedCategories,
    verdicts: scope.verdicts,
  });
}
describe('online scoring authority', () => {
  it.each([
    ['valid', 10, 0],
    ['variant', 0, 5],
    ['valid', 13, 10],
  ] as const)('uses persisted %s points (%i), not the client verdict score (%i)', (verdict, persistedPoints, clientPoints) => {
    const scoreAnswer = vi.fn(() => clientPoints);
    const deck = buildReviewCategoryDeck({
      answers: { Name: 'Alice' }, assignedHumanScoringTargetId: undefined, botRoundAnswers: [], disputedCategories: [],
      laneColor: () => 'red', onlineRevealAnswers: [{ answer: 'Alice', category: 'Name', id: 'server-self', playerId: 'me', points: persistedPoints, verdict }],
      room: { isOnline: true, playerId: 'me' }, scoreAnswer, scoringStep: 'review', selectedCategories: ['Name'],
      verdicts: { Name: 'valid' },
    });

    expect(deck[0].entries[0]).toMatchObject({ label: 'You', points: persistedPoints, verdict });
    expect(scoreAnswer).not.toHaveBeenCalled();
  });

  it('preserves local self-review scoring', () => {
    const scoreAnswer = vi.fn(() => 5);
    const deck = buildReviewCategoryDeck({
      answers: { Name: 'Alice' }, assignedHumanScoringTargetId: undefined, botRoundAnswers: [], disputedCategories: [],
      laneColor: () => 'red', onlineRevealAnswers: [], verdicts: { Name: 'variant' },
      room: { isOnline: false, playerId: 'me' }, scoreAnswer, scoringStep: 'review', selectedCategories: ['Name'],
    });

    expect(deck[0].entries[0]).toMatchObject({ label: 'You', points: 5, verdict: 'variant' });
    expect(scoreAnswer).toHaveBeenCalledExactlyOnceWith({ verdict: 'variant' });
  });

  it('keeps an online blank verdict authoritative over a local self-review fallback', () => {
    const scoreAnswer = vi.fn(() => 10);
    const deck = buildReviewCategoryDeck({
      answers: { Name: 'Alice' }, assignedHumanScoringTargetId: undefined, botRoundAnswers: [], disputedCategories: [],
      laneColor: () => 'red',
      onlineRevealAnswers: [{ answer: 'Alice', category: 'Name', id: 'server-self', playerId: 'me', points: 0, verdict: 'blank' }],
      room: { isOnline: true, playerId: 'me' }, scoreAnswer, scoringStep: 'review', selectedCategories: ['Name'], verdicts: { Name: 'valid' },
    });

    expect(deck[0].entries[0]).toMatchObject({ label: 'You', points: 0, verdict: 'blank' });
    expect(scoreAnswer).not.toHaveBeenCalled();
  });

  it.each([
    ['Élodie', 'Elodie'],
    ['New York', 'NewYork'],
    ['N’Djamena', 'NDjamena'],
  ])('marks %s and %s as duplicates using the canonical key', (selfAnswer, otherAnswer) => {
    const deck = buildReviewCategoryDeck({
      answers: { Name: selfAnswer }, assignedHumanScoringTargetId: undefined, botRoundAnswers: [], disputedCategories: [],
      laneColor: () => 'red',
      onlineRevealAnswers: [{ answer: otherAnswer, category: 'Name', id: 'server-other', playerId: 'other', playerName: 'Other', points: 5, verdict: 'duplicate' }],
      room: { isOnline: true, playerId: 'me' }, scoreAnswer: vi.fn(), scoringStep: 'review', selectedCategories: ['Name'], verdicts: { Name: 'valid' },
    });

    expect(deck[0].duplicateCount).toBe(1);
    expect(deck[0].entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ answer: selfAnswer, isDuplicate: true }),
      expect.objectContaining({ answer: otherAnswer, isDuplicate: true }),
    ]));
  });
});
it('actual compact review removes the details modal while a result is visible', () => {
  const source = appSource.slice(appSource.indexOf('  function renderCompactReview()'), appSource.indexOf('  function renderScoringSwipeDeck()')).replace('renderCompactReview()', 'render()');
  const scope: Record<string, any> = { React, ...components, resolveReviewSelection, reviewResolution, reviewDetailsVisible,
    View: 'view', Text: 'text', Pressable: 'button', Modal: 'modal', styles: {},
    reviewCategoryDeck: [{ category: 'Name', color: 'red', entries: [{ ...shared, id: 'review-self-Name', verdict: 'variant' }] }],
    disputedCategories: [], botDisputedCategories: [], disputedBotAnswers: [], botRoundAnswers: [], categoryVotes: {}, botAnswerVotes: {},
    onlineRevealAnswers: [{ id: 'server-self', playerId: 'me', category: 'Name' }], room: { playerId: 'me' },
    reviewSelection: { context: 'round', answerId: 'server-self' }, reviewContext: 'round', viewportWidth: 390,
    collapsedReviewCategories: [], totalScore: 5, scoringPolicy: { canFinish: true }, finishLabel: 'Finish', scoringNavigation: { finish: vi.fn() },
    challengeResultNotice: null, setReviewSelection: vi.fn(),
  };
  const render = appRenderer(source, scope);
  const containsModal = (node: any): boolean => Array.isArray(node) ? node.some(containsModal) : Boolean(node && typeof node === 'object' && (node.type === 'modal' || containsModal(node.children)));
  expect(containsModal(expand(render()))).toBe(true);
  scope.reviewCategoryDeck[0].entries[0].answer = 'Amara';
  scope.reviewCategoryDeck[0].entries[0].points = 0;
  expect(text(expand(render()))).toContain('Amara');
  expect(text(expand(render()))).not.toContain('Alice');
  scope.reviewContext = 'next-round-same-letter';
  expect(containsModal(expand(render()))).toBe(false);
  scope.reviewContext = 'round';
  scope.challengeResultNotice = { title: 'Vote accepted' };
  expect(containsModal(expand(render()))).toBe(false);
  scope.reviewSelection = null; scope.challengeResultNotice = null;
  expect(containsModal(expand(render()))).toBe(false);
});
it('actual result Continue clears the notice without submitting another vote', () => {
  const marker = appSource.indexOf('visible={Boolean(challengeResultNotice)}');
  const start = appSource.lastIndexOf('<Modal', marker);
  const end = appSource.indexOf('</Modal>', marker) + '</Modal>'.length;
  const clear = vi.fn();
  const scope = { React, Modal: 'modal', View: 'view', Text: 'text', Pressable: 'button', Trophy: 'icon', INK: '', styles: {},
    challengeResultNotice: { title: 'Vote accepted', message: 'Awaiting server result' }, gameAudio: { playTap: vi.fn() }, setChallengeResultNotice: clear };
  const tree = expand(appRenderer('function render() { return (' + appSource.slice(start, end) + '); }', scope)());
  function press(node: any): void {
    if (Array.isArray(node)) { node.forEach(press); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'button') node.props.onPress(); else press(node.children);
  }
  press(tree); expect(clear).toHaveBeenCalledExactlyOnceWith(null);
});
it('keeps the CPU dispute notice stable and explicitly dismissible', () => {
  const marker = appSource.indexOf('visible={screen === \'scoring\' && Boolean(activeDisputeNotice) && !showScoringHelp}');
  const start = appSource.lastIndexOf('<Modal', marker);
  const end = appSource.indexOf('</Modal>', marker) + '</Modal>'.length;
  const modalSource = appSource.slice(start, end);

  expect(modalSource).toContain('animationType="fade"');
  expect(modalSource).toContain('setActiveDisputeNotice(null)');
  expect(modalSource).toContain('Review Vote');
});
describe('rendered review components', () => {
  it('shows Shared in details and no question mark in the row', () => {
    expect(text(expand(<AnswerDetails answer={shared} />))).toContain('Shared');
    expect(text(expand(<AnswerRow answer={shared} selected onPress={() => {}} />))).not.toContain('?');
  });
  it('counts settled Shared as valid, while open Shared stays pending', () => {
    const rendered = text(expand(<ReviewSummary answers={[shared, { ...shared, id: 'other', resolution: 'open' }]} />));
    expect(rendered).toContain('1 Valid'); expect(rendered).toContain('1 Pending');
    expect(text(expand(<AnswerDetails answer={{ ...shared, resolution: 'open' }} />))).toContain('Needs review');
  });
  it('passes current selected identity to detail content and challenge callback', () => {
    const live = { ...shared, answer: 'Amara', points: 10, onlineAnswerId: 'server-current' };
    const selected = resolveReviewSelection({ context: 'round', answerId: 'self' }, 'round', [live])!;
    const challenge = vi.fn();
    const tree = expand(<AnswerDetails answer={selected} onChallenge={() => challenge(selected.onlineAnswerId)} />);
    expect(text(tree)).toContain('Amara'); expect(text(tree)).not.toContain('Alice');
    function click(node: any): void {
      if (Array.isArray(node)) { node.forEach(click); return; }
      if (!node || typeof node !== 'object') return;
      if (node.type === 'button' && text(node).includes('Challenge my score')) node.props.onPress();
      else click(node.children);
    }
    click(tree); expect(challenge).toHaveBeenCalledWith('server-current');
  });
});
