import { expect, it } from 'vitest';
import { ANSWER_MS, INTRO_MS, REVEAL_MS, answer, begin, createQuiz, makeRng, tick, toRound } from './logic.js';
import { QUESTIONS } from './questions.js';

it('前の問題の回答が次の出題後に届いても、次の問題の回答にはしない', () => {
  const rng = makeRng(7);
  const rounds = QUESTIONS.slice(0, 2).map(q => toRound(q, rng));
  const quiz = createQuiz([{ id: 1, name: 'P1', online: true }], rounds, 0);
  begin(quiz);
  tick(quiz, INTRO_MS);
  const delayed = { k: 'pick', id: rounds[0].answer };
  tick(quiz, INTRO_MS + ANSWER_MS);
  tick(quiz, INTRO_MS + ANSWER_MS + REVEAL_MS);
  expect(quiz.index).toBe(1);
  const before = quiz.seats.get(1).score;
  answer(quiz, 1, delayed, quiz.at + 1);
  console.info('delayed answer:', { oldId: delayed.id, round: quiz.index + 1, picked: quiz.seats.get(1).pick, scoreBefore: before, scoreAfter: quiz.seats.get(1).score });
  expect(quiz.seats.get(1).pick).toBeNull();
  expect(quiz.seats.get(1).score).toBe(before);
  answer(quiz, 1, { k: 'pick', id: rounds[1].answer }, quiz.at + 100);
  expect(quiz.seats.get(1).correct).toBe(1);
});
