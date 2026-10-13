import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronDown, ChevronRight, ChevronUp, CircleHelp, Minus, UserRound, X } from 'lucide-react-native';

export type ReviewStatus = 'valid' | 'variant' | 'invalid' | 'blank' | 'duplicate' | 'disputed';

export type ReviewAnswer = {
  answer: string;
  category: string;
  id: string;
  isDuplicate?: boolean;
  isNoAnswer: boolean;
  label: string;
  points: number;
  status: ReviewStatus;
  targetId?: string;
  targetType?: 'self' | 'online' | 'bot';
};

export type ReviewCategory = {
  category: string;
  color: string;
  entries: ReviewAnswer[];
  disputeCount?: number;
  hasDispute?: boolean;
};

const INK = '#141414';
const NAVY = '#111B3A';
const CREAM = '#FFF1D6';
const GREEN = '#19B76B';
const YELLOW = '#FFC83D';
const RED = '#E63223';
const GREY = '#98A2B3';

const styles = StyleSheet.create({
  summary: { backgroundColor: '#FFD9D4', borderColor: NAVY, borderRadius: 16, borderWidth: 3, gap: 14, padding: 16, shadowColor: NAVY, shadowOffset: { height: 4, width: 0 }, shadowOpacity: 1, shadowRadius: 0 },
  summaryHeading: { gap: 4 },
  eyebrow: { color: NAVY, fontSize: 13, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  summaryCopy: { color: NAVY, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  summaryPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryPill: { alignItems: 'center', borderRadius: 10, borderWidth: 2, flexDirection: 'row', gap: 5, minHeight: 40, paddingHorizontal: 10 },
  summaryPillIcon: { fontSize: 17, fontWeight: '900' },
  summaryPillValue: { color: NAVY, fontSize: 16, fontWeight: '900' },
  summaryPillLabel: { color: NAVY, fontSize: 12, fontWeight: '900' },
  categoryCard: { borderColor: NAVY, borderRadius: 14, borderWidth: 3, overflow: 'hidden', shadowColor: NAVY, shadowOffset: { height: 3, width: 0 }, shadowOpacity: 1, shadowRadius: 0 },
  categoryCardDispute: { borderWidth: 4 },
  categoryHeader: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 58, paddingHorizontal: 14, paddingVertical: 10 },
  categoryIcon: { color: NAVY, fontSize: 24, fontWeight: '900', width: 28 },
  categoryTitle: { color: NAVY, flex: 1, fontSize: 18, fontWeight: '900', textTransform: 'uppercase' },
  pendingDot: { backgroundColor: RED, borderColor: NAVY, borderRadius: 6, borderWidth: 2, height: 10, width: 10 },
  answerCount: { backgroundColor: 'rgba(255,255,255,.65)', borderColor: NAVY, borderRadius: 999, borderWidth: 2, paddingHorizontal: 8, paddingVertical: 4 },
  answerCountText: { color: NAVY, fontSize: 11, fontWeight: '900' },
  categoryBody: { backgroundColor: 'rgba(255,255,255,.55)', borderTopColor: NAVY, borderTopWidth: 2, padding: 8 },
  columnLabels: { color: '#59627A', flexDirection: 'row', fontSize: 9, fontWeight: '900', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 4, textTransform: 'uppercase' },
  answerRow: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#D7DDE6', borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 52, paddingHorizontal: 8, paddingVertical: 7 },
  answerRowSelected: { borderColor: NAVY, borderWidth: 3 },
  avatar: { alignItems: 'center', borderColor: NAVY, borderRadius: 16, borderWidth: 2, height: 32, justifyContent: 'center', width: 32 },
  playerName: { color: NAVY, fontSize: 13, fontWeight: '800', maxWidth: 90, minWidth: 48 },
  youName: { fontWeight: '900' },
  answerValue: { color: INK, flex: 1, fontSize: 14, fontWeight: '900', minWidth: 0 },
  muted: { color: '#697386' },
  scoreBadge: { alignItems: 'center', borderRadius: 8, borderWidth: 2, minWidth: 38, paddingHorizontal: 6, paddingVertical: 5 },
  scoreBadgeText: { color: NAVY, fontSize: 14, fontWeight: '900' },
  statusBadge: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', gap: 3, minWidth: 28, paddingHorizontal: 5, paddingVertical: 5 },
  statusText: { fontSize: 12, fontWeight: '900' },
  details: { backgroundColor: '#FFFFFF', borderColor: NAVY, borderRadius: 16, borderWidth: 3, gap: 12, padding: 18, shadowColor: NAVY, shadowOffset: { height: 4, width: 0 }, shadowOpacity: 1, shadowRadius: 0 },
  detailsEyebrow: { color: '#59627A', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  detailsTitle: { color: NAVY, fontSize: 24, fontWeight: '900', textTransform: 'uppercase' },
  detailsAnswerBlock: { backgroundColor: CREAM, borderColor: NAVY, borderRadius: 10, borderWidth: 2, gap: 5, padding: 12 },
  detailsLabel: { color: '#59627A', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  detailsAnswer: { color: NAVY, fontSize: 22, fontWeight: '900' },
  detailsMetaRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  detailsScore: { color: NAVY, fontSize: 20, fontWeight: '900' },
  detailsStatus: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  detailsStatusText: { fontSize: 15, fontWeight: '900' },
  detailsExplanation: { color: '#59627A', fontSize: 13, fontWeight: '700', lineHeight: 18 },
  detailsActions: { gap: 8 },
  secondaryAction: { alignItems: 'center', backgroundColor: '#E7F7FF', borderColor: NAVY, borderRadius: 10, borderWidth: 2, minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  secondaryActionText: { color: NAVY, fontSize: 13, fontWeight: '900' },
  challengeAction: { alignItems: 'center', backgroundColor: '#FFE0DC', borderColor: NAVY, borderRadius: 10, borderWidth: 2, minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  challengeActionText: { color: NAVY, fontSize: 13, fontWeight: '900' },
  roundTotal: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: NAVY, borderRadius: 14, borderWidth: 3, flexDirection: 'row', gap: 14, justifyContent: 'space-between', padding: 14, shadowColor: NAVY, shadowOffset: { height: 4, width: 0 }, shadowOpacity: 1, shadowRadius: 0 },
  totalLabel: { color: NAVY, fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  totalValue: { color: NAVY, fontSize: 26, fontWeight: '900' },
  finishButton: { alignItems: 'center', backgroundColor: '#FF5263', borderColor: NAVY, borderRadius: 11, borderWidth: 3, flexDirection: 'row', gap: 6, minHeight: 52, paddingHorizontal: 16, shadowColor: NAVY, shadowOffset: { height: 4, width: 0 }, shadowOpacity: 1, shadowRadius: 0 },
  finishText: { color: CREAM, fontSize: 15, fontWeight: '900' },
  disabled: { opacity: .5 },
  pressed: { opacity: .78 },
});


function statusMeta(status: ReviewStatus, isNoAnswer: boolean) {
  if (isNoAnswer || status === 'blank') return { label: 'No answer', short: '—', color: GREY, Icon: Minus };
  if (status === 'invalid') return { label: 'Invalid', short: '✕', color: RED, Icon: X };
  if (status === 'variant' || status === 'duplicate' || status === 'disputed') return { label: 'Needs review', short: '?', color: YELLOW, Icon: CircleHelp };
  return { label: 'Valid', short: '✓', color: GREEN, Icon: Check };
}

function scoreLabel(points: number, status: ReviewStatus, isNoAnswer: boolean) {
  if (isNoAnswer || status === 'blank') return '0';
  return String(points);
}

export function ReviewSummary({ answers }: { answers: ReviewAnswer[] }) {
  const counts = answers.reduce((result, answer) => {
    const meta = statusMeta(answer.status, answer.isNoAnswer);
    const key = meta.label === 'Valid' ? 'valid' : meta.label === 'Needs review' ? 'pending' : meta.label === 'Invalid' ? 'invalid' : 'blank';
    result[key] += 1;
    return result;
  }, { valid: 0, pending: 0, invalid: 0, blank: 0 });

  return (
    <View style={styles.summary}>
      <View style={styles.summaryHeading}>
        <Text style={styles.eyebrow}>Review</Text>
        <Text style={styles.summaryCopy}>Check each answer. Tap a row for details or to challenge it.</Text>
      </View>
      <View style={styles.summaryPills}>
        <SummaryPill label="Valid" value={counts.valid} color={GREEN} icon="✓" />
        <SummaryPill label="Pending" value={counts.pending} color={YELLOW} icon="?" />
        <SummaryPill label="Invalid" value={counts.invalid} color={RED} icon="✕" />
        <SummaryPill label="No answer" value={counts.blank} color={GREY} icon="—" />
      </View>
    </View>
  );
}

function SummaryPill({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <View style={[styles.summaryPill, { backgroundColor: `${color}30`, borderColor: color }]}>
      <Text style={[styles.summaryPillIcon, { color }]}>{icon}</Text>
      <Text style={styles.summaryPillValue}>{value}</Text>
      <Text style={styles.summaryPillLabel}>{label}</Text>
    </View>
  );
}

export function CategoryReviewCard({
  category,
  expanded,
  onToggle,
  onSelectAnswer,
  selectedAnswerId,
}: {
  category: ReviewCategory;
  expanded: boolean;
  onToggle: () => void;
  onSelectAnswer: (answer: ReviewAnswer) => void;
  selectedAnswerId?: string;
}) {
  const hasPending = category.entries.some((entry) => entry.status === 'blank' || entry.status === 'variant' || entry.isNoAnswer);
  const CategoryIcon = category.category.toLowerCase().includes('food') ? '♨' : category.category.toLowerCase().includes('place') ? '⌖' : category.category.toLowerCase().includes('animal') ? '♟' : '✦';

  return (
    <View style={[styles.categoryCard, { backgroundColor: category.color }, category.hasDispute && styles.categoryCardDispute]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onToggle} style={({ pressed }) => [styles.categoryHeader, pressed && styles.pressed]}>
        <Text style={styles.categoryIcon}>{CategoryIcon}</Text>
        <Text style={styles.categoryTitle}>{category.category}</Text>
        {hasPending ? <View style={styles.pendingDot} /> : null}
        <View style={styles.answerCount}>
          <Text style={styles.answerCountText}>
            {category.entries.length} answers{category.disputeCount ? ` · ${category.disputeCount} dispute${category.disputeCount === 1 ? '' : 's'}` : ''}
          </Text>
        </View>
        {expanded ? <ChevronUp color={INK} size={22} strokeWidth={3} /> : <ChevronDown color={INK} size={22} strokeWidth={3} />}
      </Pressable>
      {expanded ? (
        <View style={styles.categoryBody}>
          <View style={styles.columnLabels}><Text>PLAYER</Text><Text>ANSWER</Text><Text>SCORE</Text><Text>STATUS</Text></View>
          {category.entries.map((entry) => (
            <AnswerRow key={entry.id} answer={entry} selected={selectedAnswerId === entry.id} onPress={() => onSelectAnswer(entry)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function AnswerRow({ answer, selected, onPress }: { answer: ReviewAnswer; selected: boolean; onPress: () => void }) {
  const meta = statusMeta(answer.status, answer.isNoAnswer);
  const StatusIcon = meta.Icon;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.answerRow, selected && styles.answerRowSelected, pressed && styles.pressed]}>
      <View style={[styles.avatar, { backgroundColor: answer.label === 'You' ? '#FFB3B0' : '#D9D2FF' }]}><UserRound color={INK} size={17} strokeWidth={3} /></View>
      <Text numberOfLines={1} style={[styles.playerName, answer.label === 'You' && styles.youName]}>{answer.label}</Text>
      <Text numberOfLines={1} style={[styles.answerValue, answer.isNoAnswer && styles.muted]}>{answer.answer}</Text>
      <View style={[styles.scoreBadge, { backgroundColor: `${meta.color}35`, borderColor: meta.color }]}><Text style={styles.scoreBadgeText}>{scoreLabel(answer.points, answer.status, answer.isNoAnswer)}</Text></View>
      <View style={[styles.statusBadge, { backgroundColor: `${meta.color}28` }]}><StatusIcon color={meta.color} size={15} strokeWidth={3} /><Text style={[styles.statusText, { color: meta.color }]}>{meta.short}</Text></View>
      <ChevronRight color={INK} size={18} strokeWidth={3} />
    </Pressable>
  );
}

export function AnswerDetails({ answer, challengeControls, onCheckMeaning, onChallenge }: { answer: ReviewAnswer; challengeControls?: React.ReactNode; onCheckMeaning?: () => void; onChallenge?: () => void }) {
  const meta = statusMeta(answer.status, answer.isNoAnswer);
  const StatusIcon = meta.Icon;
  return (
    <View style={styles.details}>
      <Text style={styles.detailsEyebrow}>{answer.label === 'You' ? 'Your answer' : `${answer.label}'s answer`}</Text>
      <Text style={styles.detailsTitle}>{answer.category}</Text>
      <View style={styles.detailsAnswerBlock}><Text style={styles.detailsLabel}>Answer</Text><Text style={[styles.detailsAnswer, answer.isNoAnswer && styles.muted]}>{answer.answer}</Text></View>
      <View style={styles.detailsMetaRow}>
        <View><Text style={styles.detailsLabel}>Score</Text><Text style={styles.detailsScore}>{scoreLabel(answer.points, answer.status, answer.isNoAnswer)} points</Text></View>
        <View style={styles.detailsStatus}><StatusIcon color={meta.color} size={18} strokeWidth={3} /><Text style={[styles.detailsStatusText, { color: meta.color }]}>{meta.label}</Text></View>
      </View>
      <Text style={styles.detailsExplanation}>{answer.label === 'You' && answer.isNoAnswer ? 'No word was submitted for this category.' : `This answer was marked ${meta.label.toLowerCase()}.`}</Text>
      <View style={styles.detailsActions}>
        {onCheckMeaning && !answer.isNoAnswer ? <Pressable onPress={onCheckMeaning} style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}><Text style={styles.secondaryActionText}>Check meaning</Text></Pressable> : null}
        {onChallenge ? <Pressable onPress={onChallenge} style={({ pressed }) => [styles.challengeAction, pressed && styles.pressed]}><Text style={styles.challengeActionText}>{answer.label === 'You' ? 'Challenge my score' : 'Challenge score'}</Text></Pressable> : null}
        {challengeControls}
      </View>
    </View>
  );
}

export function RoundTotal({ total, onFinish, disabled, label = 'Finish Round' }: { total: number; onFinish: () => void; disabled?: boolean; label?: string }) {
  return <View style={styles.roundTotal}><View><Text style={styles.totalLabel}>Round total</Text><Text style={styles.totalValue}>{total} points</Text></View><Pressable accessibilityRole="button" disabled={disabled} onPress={onFinish} style={({ pressed }) => [styles.finishButton, disabled && styles.disabled, pressed && !disabled && styles.pressed]}><Text style={styles.finishText}>{label}</Text><ChevronRight color={CREAM} size={24} strokeWidth={3} /></Pressable></View>;
}
