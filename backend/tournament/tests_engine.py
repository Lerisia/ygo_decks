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


class SeededBracketTest(SimpleTestCase):
    def test_four_seeds_pair_one_v_four(self):
        from .engine import seeded_bracket
        self.assertEqual(seeded_bracket([10, 20, 30, 40]), [(10, 40), (20, 30)])

    def test_eight_seeds_standard_order(self):
        from .engine import seeded_bracket
        ids = [1, 2, 3, 4, 5, 6, 7, 8]
        pairs = seeded_bracket(ids)
        self.assertEqual(pairs, [(1, 8), (4, 5), (2, 7), (3, 6)])

    def test_non_power_of_two_gives_top_seeds_byes(self):
        from .engine import seeded_bracket
        pairs = seeded_bracket([1, 2, 3, 4, 5, 6])   # bracket of 8: seeds 1,2 get byes
        self.assertEqual(pairs, [(1, None), (4, 5), (2, None), (3, 6)])

    def test_two_seeds_is_the_final(self):
        from .engine import seeded_bracket
        self.assertEqual(seeded_bracket([7, 9]), [(7, 9)])


class GroupStageTest(SimpleTestCase):
    def test_split_deals_evenly_and_reproducibly(self):
        from .engine import group_split
        groups = group_split(list(range(1, 11)), 4, make_rng("g"))
        self.assertEqual(sorted(len(g) for g in groups), [2, 2, 3, 3])
        self.assertEqual(sorted(x for g in groups for x in g), list(range(1, 11)))
        self.assertEqual(groups, group_split(list(range(1, 11)), 4, make_rng("g")))

    def test_schedule_everyone_meets_groupmates_once(self):
        from .engine import group_schedule
        groups = [[1, 2, 3, 4], [5, 6, 7]]
        rounds = group_schedule(groups, make_rng("g"))
        self.assertEqual(len(rounds), 3)                    # max(4-1, 3 with bye)
        seen = set()
        for rnd in rounds:
            for gi, (a, b) in rnd:
                self.assertIn(a, groups[gi])
                if b is not None:
                    self.assertIn(b, groups[gi])
                    seen.add(frozenset((a, b)))
        self.assertEqual(len(seen), 6 + 3)                  # C(4,2) + C(3,2)

    def test_schedule_uses_bye_in_odd_group_only(self):
        from .engine import group_schedule
        rounds = group_schedule([[1, 2, 3, 4], [5, 6, 7]], make_rng("g"))
        byes = [(gi, a) for rnd in rounds for gi, (a, b) in rnd if b is None]
        self.assertEqual(sorted(g for g, _ in byes), [1, 1, 1])
        self.assertEqual(sorted(a for _, a in byes), [5, 6, 7])

    def test_qualifiers_tiered_by_place_then_points(self):
        from .engine import group_qualifiers
        rankings = [[(1, 9), (2, 6), (3, 0)], [(4, 6), (5, 6), (6, 3)]]
        self.assertEqual(group_qualifiers(rankings, 2), [1, 4, 2, 5])   # winners first, then runners-up
        self.assertEqual(group_qualifiers(rankings, 1), [1, 4])

    def test_qualifiers_skip_short_groups(self):
        from .engine import group_qualifiers
        self.assertEqual(group_qualifiers([[(1, 3), (2, 0)], [(3, 3)]], 2), [1, 3, 2])


class DoubleElimLosersRoundTest(SimpleTestCase):
    def test_first_drop_pairs_losers_among_themselves(self):
        from .engine import losers_round
        pairs, waiting = losers_round([], [1, 2, 3, 4])
        self.assertEqual(pairs, [(1, 2), (3, 4)])
        self.assertEqual(waiting, [])

    def test_odd_losers_get_a_bye(self):
        from .engine import losers_round
        pairs, waiting = losers_round([], [1])
        self.assertEqual(pairs, [(1, None)])

    def test_more_survivors_than_droppers_is_a_major_round(self):
        from .engine import losers_round
        pairs, waiting = losers_round([10, 20], [5])
        self.assertEqual(pairs, [(10, 20)])
        self.assertEqual(waiting, [5])           # the WB loser waits one round

    def test_equal_counts_zip_reversed(self):
        from .engine import losers_round
        pairs, waiting = losers_round([10, 20], [5, 6])
        self.assertEqual(pairs, [(10, 6), (20, 5)])
        self.assertEqual(waiting, [])

    def test_more_droppers_than_survivors_pairs_the_rest(self):
        from .engine import losers_round
        pairs, waiting = losers_round([10], [5, 6, 7])
        self.assertEqual(pairs, [(10, 7), (5, 6)])
        self.assertEqual(waiting, [])

    def test_single_survivor_no_droppers_is_the_losers_champion(self):
        from .engine import losers_round
        self.assertEqual(losers_round([10], []), ([], []))
