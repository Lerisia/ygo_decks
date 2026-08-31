"""Spec for the pure pairing engine. No DB involved."""
from django.test import SimpleTestCase

from .engine import (
    make_rng,
    round_robin_schedule,
    single_elim_round1,
    pair_adjacent,
    swiss_pairs,
    buchholz_scores,
)


class RoundRobinTest(SimpleTestCase):
    def test_even_field_everyone_meets_once(self):
        ids = [1, 2, 3, 4]
        rounds = round_robin_schedule(ids, make_rng("s"))
        self.assertEqual(len(rounds), 3)
        seen = set()
        for rnd in rounds:
            self.assertEqual(len(rnd), 2)
            players = [p for pair in rnd for p in pair]
            self.assertEqual(sorted(players), ids)  # everyone plays every round
            for a, b in rnd:
                seen.add(frozenset((a, b)))
        self.assertEqual(len(seen), 6)  # C(4,2)

    def test_odd_field_gets_one_bye_each(self):
        ids = [1, 2, 3, 4, 5]
        rounds = round_robin_schedule(ids, make_rng("s"))
        self.assertEqual(len(rounds), 5)
        byes = []
        seen = set()
        for rnd in rounds:
            round_players = []
            for a, b in rnd:
                if b is None:
                    byes.append(a)
                else:
                    seen.add(frozenset((a, b)))
                    round_players += [a, b]
        self.assertEqual(sorted(byes), ids)          # exactly one bye each
        self.assertEqual(len(seen), 10)              # C(5,2) real matches

    def test_same_seed_reproduces_schedule(self):
        ids = list(range(1, 9))
        self.assertEqual(round_robin_schedule(ids, make_rng("x")),
                         round_robin_schedule(ids, make_rng("x")))


class SingleElimTest(SimpleTestCase):
    def test_power_of_two_no_byes(self):
        pairs = single_elim_round1(list(range(1, 9)), make_rng("s"))
        self.assertEqual(len(pairs), 4)
        self.assertTrue(all(b is not None for _, b in pairs))
        players = [p for pair in pairs for p in pair]
        self.assertEqual(sorted(players), list(range(1, 9)))

    def test_five_players_three_byes(self):
        pairs = single_elim_round1([1, 2, 3, 4, 5], make_rng("s"))
        byes = [a for a, b in pairs if b is None]
        real = [(a, b) for a, b in pairs if b is not None]
        self.assertEqual(len(byes), 3)   # bracket of 8
        self.assertEqual(len(real), 1)
        used = byes + [p for pair in real for p in pair]
        self.assertEqual(sorted(used), [1, 2, 3, 4, 5])

    def test_thirteen_players(self):
        pairs = single_elim_round1(list(range(13)), make_rng("s"))
        byes = [a for a, b in pairs if b is None]
        real = [p for p in pairs if p[1] is not None]
        self.assertEqual(len(byes), 3)   # bracket of 16
        self.assertEqual(len(real), 5)

    def test_next_round_pairs_adjacent_winners(self):
        self.assertEqual(pair_adjacent([10, 20, 30, 40]), [(10, 20), (30, 40)])
        self.assertEqual(pair_adjacent([10, 20, 30]), [(10, 20), (30, None)])


class SwissTest(SimpleTestCase):
    def test_pairs_within_same_score_group(self):
        records = [(1, 3), (2, 3), (3, 0), (4, 0)]
        pairs = swiss_pairs(records, history=set(), prior_byes=set(), rng=make_rng("s"))
        self.assertIn(frozenset((1, 2)), {frozenset(p) for p in pairs})
        self.assertIn(frozenset((3, 4)), {frozenset(p) for p in pairs})

    def test_avoids_rematch(self):
        records = [(1, 3), (2, 3), (3, 3), (4, 3)]
        history = {frozenset((1, 2)), frozenset((3, 4))}
        pairs = swiss_pairs(records, history=history, prior_byes=set(), rng=make_rng("s"))
        for a, b in pairs:
            self.assertNotIn(frozenset((a, b)), history)

    def test_odd_count_bye_goes_to_lowest_without_prior_bye(self):
        records = [(1, 6), (2, 3), (3, 3), (4, 0), (5, 0)]
        pairs = swiss_pairs(records, history=set(), prior_byes={5}, rng=make_rng("s"))
        bye = next(a for a, b in pairs if b is None)
        self.assertEqual(bye, 4)   # 5 already had a bye, so 4 (lowest score) gets it

    def test_everyone_paired_exactly_once(self):
        records = [(i, 0) for i in range(1, 9)]
        pairs = swiss_pairs(records, history=set(), prior_byes=set(), rng=make_rng("s"))
        players = [p for pair in pairs for p in pair if p is not None]
        self.assertEqual(sorted(players), list(range(1, 9)))

    def test_same_seed_reproducible(self):
        records = [(i, i % 3) for i in range(1, 10)]
        a = swiss_pairs(records, set(), set(), make_rng("k"))
        b = swiss_pairs(records, set(), set(), make_rng("k"))
        self.assertEqual(a, b)


class BuchholzTest(SimpleTestCase):
    def test_sum_of_opponents_points(self):
        points = {1: 6, 2: 3, 3: 3, 4: 0}
        opponents = {1: [2, 3], 2: [1, 4], 3: [1, 4], 4: [2, 3]}
        scores = buchholz_scores(points, opponents)
        self.assertEqual(scores[1], 6)   # 3 + 3
        self.assertEqual(scores[2], 6)   # 6 + 0
        self.assertEqual(scores[4], 6)   # 3 + 3
