package com.elyss.ygodecks.plugins.tracker;

import java.util.LinkedHashMap;
import java.util.Map;

public class RankCalculator {

    private static final String[] RANK_ORDER = {
        "rookie2", "rookie1",
        "bronze5", "bronze4", "bronze3", "bronze2", "bronze1",
        "silver5", "silver4", "silver3", "silver2", "silver1",
        "gold5", "gold4", "gold3", "gold2", "gold1",
        "platinum5", "platinum4", "platinum3", "platinum2", "platinum1",
        "diamond5", "diamond4", "diamond3", "diamond2", "diamond1",
        "master5", "master4", "master3", "master2", "master1",
    };

    private static final Map<String, String> LABELS = new LinkedHashMap<>();
    static {
        LABELS.put("rookie2", "루키 2"); LABELS.put("rookie1", "루키 1");
        LABELS.put("bronze5", "브론즈 5"); LABELS.put("bronze4", "브론즈 4");
        LABELS.put("bronze3", "브론즈 3"); LABELS.put("bronze2", "브론즈 2"); LABELS.put("bronze1", "브론즈 1");
        LABELS.put("silver5", "실버 5"); LABELS.put("silver4", "실버 4");
        LABELS.put("silver3", "실버 3"); LABELS.put("silver2", "실버 2"); LABELS.put("silver1", "실버 1");
        LABELS.put("gold5", "골드 5"); LABELS.put("gold4", "골드 4");
        LABELS.put("gold3", "골드 3"); LABELS.put("gold2", "골드 2"); LABELS.put("gold1", "골드 1");
        LABELS.put("platinum5", "플래티넘 5"); LABELS.put("platinum4", "플래티넘 4");
        LABELS.put("platinum3", "플래티넘 3"); LABELS.put("platinum2", "플래티넘 2"); LABELS.put("platinum1", "플래티넘 1");
        LABELS.put("diamond5", "다이아 5"); LABELS.put("diamond4", "다이아 4");
        LABELS.put("diamond3", "다이아 3"); LABELS.put("diamond2", "다이아 2"); LABELS.put("diamond1", "다이아 1");
        LABELS.put("master5", "마스터 5"); LABELS.put("master4", "마스터 4");
        LABELS.put("master3", "마스터 3"); LABELS.put("master2", "마스터 2"); LABELS.put("master1", "마스터 1");
    }

    public static String getLabel(String rank) {
        String label = LABELS.get(rank);
        return label != null ? label : rank;
    }

    private static String getTier(String rank) {
        return rank.replaceAll("[0-9]", "");
    }

    private static String getUpperRank(String rank) {
        for (int i = 0; i < RANK_ORDER.length - 1; i++) {
            if (RANK_ORDER[i].equals(rank)) return RANK_ORDER[i + 1];
        }
        return rank;
    }

    private static String getLowerRank(String rank) {
        for (int i = 1; i < RANK_ORDER.length; i++) {
            if (RANK_ORDER[i].equals(rank)) return RANK_ORDER[i - 1];
        }
        return rank;
    }

    public static String[] getNextRankState(String rank, int wins, boolean isWin) {
        if (rank == null || rank.isEmpty()) return new String[]{rank, String.valueOf(wins)};

        String tier = getTier(rank);

        if ("master1".equals(rank)) return new String[]{rank, "0"};

        if ("rookie".equals(tier) || "bronze".equals(tier)) {
            if (isWin) return new String[]{getUpperRank(rank), "0"};
            return new String[]{rank, "0"};
        }

        if ("silver".equals(tier)) {
            if (isWin) {
                if (wins + 1 >= 2) return new String[]{getUpperRank(rank), "0"};
                return new String[]{rank, String.valueOf(wins + 1)};
            }
            return new String[]{rank, String.valueOf(wins)};
        }

        if ("gold".equals(tier)) {
            if (isWin) {
                if (wins + 1 >= 4) return new String[]{getUpperRank(rank), "0"};
                return new String[]{rank, String.valueOf(wins + 1)};
            }
            return new String[]{rank, String.valueOf(wins)};
        }

        if ("platinum".equals(tier)) {
            boolean isTier5 = rank.equals("platinum5");
            if (isWin) {
                int next = wins < 0 ? 1 : wins + 1;
                if (next >= 4) return new String[]{getUpperRank(rank), "0"};
                return new String[]{rank, String.valueOf(next)};
            }
            if (isTier5) return new String[]{rank, String.valueOf(Math.max(0, wins - 1))};
            if (wins <= -3) return new String[]{getLowerRank(rank), "0"};
            return new String[]{rank, String.valueOf(wins - 1)};
        }

        if ("diamond".equals(tier)) {
            boolean isTier5 = rank.equals("diamond5");
            if (isWin) {
                int next = wins < 0 ? 1 : wins + 1;
                if (next >= 4) return new String[]{getUpperRank(rank), "0"};
                return new String[]{rank, String.valueOf(next)};
            }
            if (isTier5) return new String[]{rank, String.valueOf(Math.max(0, wins - 1))};
            if (wins <= -2) return new String[]{getLowerRank(rank), "0"};
            return new String[]{rank, String.valueOf(wins - 1)};
        }

        if ("master".equals(tier)) {
            boolean isTier5 = rank.equals("master5");
            if (isWin) {
                int next = wins < 0 ? 1 : wins + 1;
                if (next >= 5) return new String[]{getUpperRank(rank), "0"};
                return new String[]{rank, String.valueOf(next)};
            }
            if (isTier5) return new String[]{rank, String.valueOf(Math.max(0, wins - 1))};
            if (wins <= -2) return new String[]{getLowerRank(rank), "0"};
            return new String[]{rank, String.valueOf(wins - 1)};
        }

        return new String[]{rank, String.valueOf(wins)};
    }

    public static String formatDisplay(String rank, int wins) {
        return getLabel(rank) + " " + wins + "승";
    }
}
