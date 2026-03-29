package com.elyss.ygodecks.plugins.tracker;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.util.Log;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public class ScreenAnalyzer {

    private static final String TAG = "ScreenAnalyzer";
    private static final TextRecognizer textRecognizer =
            TextRecognition.getClient(new KoreanTextRecognizerOptions.Builder().build());

    public enum DetectionType { COIN_TOSS, FIRST_SECOND, DUEL_RESULT }
    public enum State { WAITING_COIN, WAITING_FIRST_SECOND, IN_DUEL }

    public static class AnalysisResult {
        public DetectionType type;
        public String value;
        public AnalysisResult(DetectionType type, String value) {
            this.type = type;
            this.value = value;
        }
    }

    private static State currentState = State.WAITING_COIN;
    private static long lastDetectionTime = 0;
    private static boolean onCoinScreen = false;
    private static CoinResult lastCoinValue = CoinResult.NONE;
    private static int coinStableCount = 0;
    private static final int COIN_STABLE_REQUIRED = 2;
    private static float maxGold = 0;
    private static float maxDark = 0;
    public static String detectionSummary = "";

    public static AnalysisResult analyze(Bitmap bitmap) {
        long now = System.currentTimeMillis();
        long cooldown = 500;
        if (now - lastDetectionTime < cooldown) return null;

        int w = bitmap.getWidth();
        int h = bitmap.getHeight();

        switch (currentState) {
            case WAITING_COIN: {
                CoinResult coin = detectCoinWithEffects(bitmap, w, h);

                if (coin == CoinResult.NONE) {
                    onCoinScreen = false;
                    lastCoinValue = CoinResult.NONE;
                    coinStableCount = 0;
                    ScreenCaptureService.statusLog = "코인 대기 중";
                    break;
                }

                onCoinScreen = true;

                if (coin == CoinResult.SPINNING) {
                    // Coin is alternating - reset stability
                    lastCoinValue = CoinResult.NONE;
                    coinStableCount = 0;
                    ScreenCaptureService.statusLog = "코인 회전 중";
                } else if (coin == CoinResult.GOLD || coin == CoinResult.BLACK) {
                    // Gold or black detected - check stability
                    if (coin == lastCoinValue) {
                        coinStableCount++;
                    } else {
                        lastCoinValue = coin;
                        coinStableCount = 1;
                    }

                    ScreenCaptureService.statusLog = (coin == CoinResult.GOLD ? "금색" : "검정")
                            + " (" + coinStableCount + "/" + COIN_STABLE_REQUIRED + ")";

                    if (coinStableCount >= COIN_STABLE_REQUIRED) {
                        String val = (coin == CoinResult.GOLD) ? "win" : "lose";
                        detectionSummary = "코인:" + (coin == CoinResult.GOLD ? "앞" : "뒤");
                        ScreenCaptureService.statusLog = detectionSummary;
                        onCoinScreen = false;
                        lastCoinValue = CoinResult.NONE;
                        coinStableCount = 0;
                        currentState = State.WAITING_FIRST_SECOND;
                        lastDetectionTime = now;
                        return new AnalysisResult(DetectionType.COIN_TOSS, val);
                    }
                }
                break;
            }

            case WAITING_FIRST_SECOND: {
                // Only check turn button when game board is loaded (bright screen)
                if (!isScreenBright(bitmap, w, h)) {
                    ScreenCaptureService.statusLog = "보드 로딩 대기 중";
                    break;
                }
                // Detect turn button color for first/second
                TurnColor turn = detectTurnButtonColor(bitmap, w, h);
                if (turn != TurnColor.NONE) {
                    String val = (turn == TurnColor.BLUE) ? "first" : "second";
                    detectionSummary += " | " + (turn == TurnColor.BLUE ? "선공" : "후공");
                    ScreenCaptureService.statusLog = detectionSummary;
                    currentState = State.IN_DUEL;
                    lastDetectionTime = now;
                    return new AnalysisResult(DetectionType.FIRST_SECOND, val);
                }
                ScreenCaptureService.statusLog = "선후공 대기 중";
                break;
            }

            case IN_DUEL: {
                // Detect result screen by large gray/white text over game board
                String resultVal = detectResultScreen(bitmap, w, h);
                if (resultVal != null) {
                    detectionSummary += " | " + ("win".equals(resultVal) ? "승리" : "패배");
                    ScreenCaptureService.statusLog = detectionSummary;
                    currentState = State.WAITING_COIN;
                    lastDetectionTime = now;
                    return new AnalysisResult(DetectionType.DUEL_RESULT, resultVal);
                }
                ScreenCaptureService.statusLog = "듀얼 중";
                break;
            }
        }

        return null;
    }

    public static void reset() {
        currentState = State.WAITING_COIN;
        lastDetectionTime = 0;
        onCoinScreen = false;
        lastCoinValue = CoinResult.NONE;
        coinStableCount = 0;
        maxGold = 0;
        maxDark = 0;
        detectionSummary = "";
    }

    // === COIN TOSS DETECTION ===

    private enum CoinResult { NONE, SPINNING, GOLD, BLACK }

    /**
     * Detect coin toss state:
     * - SPINNING: purple effects in center (coin toss screen confirmed)
     * - GOLD: no purple, gold center (front face = win)
     * - BLACK: no purple, dark center (back face = lose), only valid after SPINNING seen
     * - NONE: not a coin toss screen
     */
    private static CoinResult detectCoinWithEffects(Bitmap bmp, int w, int h) {
        int cx = w / 2;
        int cy = h / 2;
        int radius = Math.min(w, h) / 8;
        int step = Math.max(radius / 10, 1);

        int goldCount = 0;
        int darkCount = 0;
        int purpleCount = 0;
        int samples = 0;

        for (int y = cy - radius; y < cy + radius; y += step) {
            for (int x = cx - radius; x < cx + radius; x += step) {
                if (x < 0 || x >= w || y < 0 || y >= h) continue;
                float[] hsv = new float[3];
                Color.colorToHSV(bmp.getPixel(x, y), hsv);

                if (hsv[0] > 20 && hsv[0] < 55 && hsv[1] > 0.4 && hsv[2] > 0.5) {
                    goldCount++;
                }
                if (hsv[2] < 0.05) {
                    darkCount++;
                }
                if (hsv[0] > 250 && hsv[0] < 340 && hsv[1] > 0.25 && hsv[2] > 0.25) {
                    purpleCount++;
                }
                samples++;
            }
        }

        if (samples == 0) return CoinResult.NONE;

        float purpleRatio = (float) purpleCount / samples;
        float goldRatio = (float) goldCount / samples;
        float darkRatio = (float) darkCount / samples;

        if (purpleRatio > 0.05) {
            if (goldRatio > maxGold) maxGold = goldRatio;
            if (darkRatio > maxDark) maxDark = darkRatio;
        }

        ScreenCaptureService.statusLog = String.format("P:%.0f G:%.0f D:%.0f 최대G:%.0f D:%.0f",
                purpleRatio * 100, goldRatio * 100, darkRatio * 100, maxGold * 100, maxDark * 100);

        // Not on coin screen (no purple effects)
        if (purpleRatio < 0.05) return CoinResult.NONE;

        // Purple present = we're on coin toss screen
        // Gold present with purple = front face (win)
        if (goldRatio > 0.10) return CoinResult.GOLD;

        // No gold + dark center + purple = back face (lose)
        if (goldRatio < 0.03 && darkRatio > 0.30) return CoinResult.BLACK;

        // Purple present but can't determine yet (still spinning)
        return CoinResult.SPINNING;
    }

    /**
     * Check if screen is bright overall (game board loaded vs dark coin toss / loading screen).
     */
    private static boolean isScreenBright(Bitmap bmp, int w, int h) {
        int brightCount = 0;
        int samples = 0;
        int step = Math.max(w / 20, 1);

        for (int y = h / 4; y < h * 3 / 4; y += step * 2) {
            for (int x = w / 4; x < w * 3 / 4; x += step * 2) {
                float[] hsv = new float[3];
                Color.colorToHSV(bmp.getPixel(x, y), hsv);
                if (hsv[2] > 0.35) brightCount++;
                samples++;
            }
        }

        return samples > 0 && (float) brightCount / samples > 0.4;
    }

    // === TURN BUTTON DETECTION ===

    private enum TurnColor { NONE, BLUE, RED }

    private static TurnColor detectTurnButtonColor(Bitmap bmp, int w, int h) {
        // Scan right portion of screen for turn indicator
        int startX = (int)(w * 0.65);
        int endX = (int)(w * 0.95);
        int startY = (int)(h * 0.35);
        int endY = (int)(h * 0.6);
        int step = Math.max((endX - startX) / 20, 1);

        int blueCount = 0;
        int redCount = 0;
        int samples = 0;

        for (int y = startY; y < endY; y += step) {
            for (int x = startX; x < endX; x += step) {
                if (x >= w || y >= h) continue;
                float[] hsv = new float[3];
                Color.colorToHSV(bmp.getPixel(x, y), hsv);

                if (hsv[0] > 190 && hsv[0] < 240 && hsv[1] > 0.4 && hsv[2] > 0.35) {
                    blueCount++;
                }
                if ((hsv[0] > 340 || hsv[0] < 15) && hsv[1] > 0.4 && hsv[2] > 0.35) {
                    redCount++;
                }
                samples++;
            }
        }

        if (samples == 0) return TurnColor.NONE;

        float blueRatio = (float) blueCount / samples;
        float redRatio = (float) redCount / samples;

        ScreenCaptureService.statusLog = String.format("턴탐색 B:%.0f%% R:%.0f%%", blueRatio * 100, redRatio * 100);

        if (blueRatio > 0.1 && blueRatio > redRatio * 3) return TurnColor.BLUE;
        if (redRatio > 0.1 && redRatio > blueRatio * 3) return TurnColor.RED;

        return TurnColor.NONE;
    }

    // === VICTORY/DEFEAT DETECTION ===

    /**
     * Detect result screen by checking for large neutral/bright text in center.
     * Normal gameplay has green/brown game board. Result screen overlays large
     * metallic gray/white text (VICTORY or DEFEAT).
     *
     * Returns "win" or "lose" if result screen detected, null otherwise.
     * Distinguishes by checking bottom-left area for golden crown (winner indicator).
     */
    private static String detectResultScreen(Bitmap bmp, int w, int h) {
        // Check center area for unusual amount of bright neutral pixels
        int brightNeutral = 0;
        int samples = 0;
        int startY = (int)(h * 0.25);
        int endY = (int)(h * 0.55);
        int step = Math.max(w / 50, 1);

        for (int y = startY; y < endY; y += step) {
            for (int x = w / 6; x < w * 5 / 6; x += step) {
                int pixel = bmp.getPixel(x, y);
                int r = Color.red(pixel);
                int g = Color.green(pixel);
                int b = Color.blue(pixel);

                // Bright and neutral (gray/white) - not strongly colored
                // The metallic text has R≈G≈B and values > 150
                if (r > 150 && g > 150 && b > 150) {
                    int maxDiff = Math.max(Math.abs(r - g), Math.max(Math.abs(r - b), Math.abs(g - b)));
                    if (maxDiff < 50) {
                        brightNeutral++;
                    }
                }
                samples++;
            }
        }

        if (samples == 0) return null;
        float ratio = (float) brightNeutral / samples;

        // Normal gameplay: ratio < 0.03. Result screen: ratio > 0.06
        if (ratio < 0.05) return null;

        ScreenCaptureService.statusLog = String.format("결과화면? %.1f%%", ratio * 100);

        // Detected result screen. Now determine win or lose.
        // Check bottom-left area for golden crown/trophy (appears on winner's side)
        int crownGold = 0;
        int crownSamples = 0;
        int crownStep = Math.max(w / 60, 1);

        // Left player area: bottom-left quarter
        for (int y = (int)(h * 0.7); y < (int)(h * 0.9); y += crownStep) {
            for (int x = 0; x < (int)(w * 0.2); x += crownStep) {
                if (x >= w || y >= h) continue;
                float[] hsv = new float[3];
                Color.colorToHSV(bmp.getPixel(x, y), hsv);
                // Gold/yellow crown
                if (hsv[0] > 30 && hsv[0] < 55 && hsv[1] > 0.4 && hsv[2] > 0.5) {
                    crownGold++;
                }
                crownSamples++;
            }
        }

        float crownRatio = crownSamples > 0 ? (float) crownGold / crownSamples : 0;

        // Crown on left = we won. No crown on left = we lost.
        return crownRatio > 0.03 ? "win" : "lose";
    }
}
