package com.elyss.ygodecks.plugins.tracker;

import android.graphics.Bitmap;
import android.graphics.Color;

public class ScreenAnalyzer {

    public enum DetectionType {
        COIN_TOSS,
        DUEL_RESULT
    }

    public static class AnalysisResult {
        public DetectionType type;
        public String value;

        public AnalysisResult(DetectionType type, String value) {
            this.type = type;
            this.value = value;
        }
    }

    public static AnalysisResult analyze(Bitmap bitmap) {
        AnalysisResult duelResult = detectDuelResult(bitmap);
        if (duelResult != null) return duelResult;

        AnalysisResult coinResult = detectCoinToss(bitmap);
        if (coinResult != null) return coinResult;

        return null;
    }

    private static AnalysisResult detectDuelResult(Bitmap bitmap) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();

        int centerX = width / 2;
        int centerY = height / 2;
        int sampleRadius = Math.min(width, height) / 6;

        int blueCount = 0;
        int redCount = 0;
        int totalSamples = 0;

        for (int y = centerY - sampleRadius; y < centerY + sampleRadius; y += 4) {
            for (int x = centerX - sampleRadius; x < centerX + sampleRadius; x += 4) {
                if (x < 0 || x >= width || y < 0 || y >= height) continue;
                int pixel = bitmap.getPixel(x, y);
                int r = Color.red(pixel);
                int g = Color.green(pixel);
                int b = Color.blue(pixel);

                if (b > 150 && b > r * 1.5 && b > g * 1.5) {
                    blueCount++;
                }
                if (r > 150 && r > b * 1.5 && r > g * 1.2) {
                    redCount++;
                }
                totalSamples++;
            }
        }

        if (totalSamples == 0) return null;

        float blueRatio = (float) blueCount / totalSamples;
        float redRatio = (float) redCount / totalSamples;

        if (blueRatio > 0.3) {
            return new AnalysisResult(DetectionType.DUEL_RESULT, "win");
        }
        if (redRatio > 0.3) {
            return new AnalysisResult(DetectionType.DUEL_RESULT, "lose");
        }

        return null;
    }

    private static AnalysisResult detectCoinToss(Bitmap bitmap) {
        // Master Duel coin toss screen analysis
        // The coin toss result screen shows distinct visual patterns
        // This will be refined with actual screenshot samples
        //
        // For now: detect based on color patterns in the upper portion
        // of the screen where coin toss results appear

        int width = bitmap.getWidth();
        int height = bitmap.getHeight();

        // Sample the upper-center area where coin toss text appears
        int sampleTop = height / 4;
        int sampleBottom = height / 2;
        int sampleLeft = width / 4;
        int sampleRight = width * 3 / 4;

        int goldCount = 0;
        int darkCount = 0;
        int totalSamples = 0;

        for (int y = sampleTop; y < sampleBottom; y += 4) {
            for (int x = sampleLeft; x < sampleRight; x += 4) {
                int pixel = bitmap.getPixel(x, y);
                int r = Color.red(pixel);
                int g = Color.green(pixel);
                int b = Color.blue(pixel);

                // Gold/yellow tones (coin toss win indicator)
                if (r > 180 && g > 150 && b < 100) {
                    goldCount++;
                }
                // Dark/gray tones (coin toss lose indicator)
                if (r < 80 && g < 80 && b < 100 && r > 20) {
                    darkCount++;
                }
                totalSamples++;
            }
        }

        if (totalSamples == 0) return null;

        float goldRatio = (float) goldCount / totalSamples;
        float darkRatio = (float) darkCount / totalSamples;

        if (goldRatio > 0.15) {
            return new AnalysisResult(DetectionType.COIN_TOSS, "win");
        }
        if (darkRatio > 0.4) {
            return new AnalysisResult(DetectionType.COIN_TOSS, "lose");
        }

        return null;
    }
}
