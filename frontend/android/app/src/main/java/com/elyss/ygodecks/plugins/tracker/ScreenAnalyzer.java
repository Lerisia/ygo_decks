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
    private static CoinResult lastSeenCoinResult = CoinResult.NONE;
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
                    // Left coin screen - if we had a result, confirm it
                    if (onCoinScreen && lastSeenCoinResult != CoinResult.NONE) {
                        String val = (lastSeenCoinResult == CoinResult.GOLD) ? "win" : "lose";
                        detectionSummary = "코인:" + (lastSeenCoinResult == CoinResult.GOLD ? "앞" : "뒤");
                        ScreenCaptureService.statusLog = detectionSummary;
                        onCoinScreen = false;
                        lastSeenCoinResult = CoinResult.NONE;
                        currentState = State.WAITING_FIRST_SECOND;
                        lastDetectionTime = now;
                        return new AnalysisResult(DetectionType.COIN_TOSS, val);
                    }
                    onCoinScreen = false;
                    lastSeenCoinResult = CoinResult.NONE;
                    break;
                }

                onCoinScreen = true;

                if (coin == CoinResult.SPINNING) {
                    // Reset during spinning so initial flash doesn't persist
                    lastSeenCoinResult = CoinResult.NONE;
                    ScreenCaptureService.statusLog = "코인 회전 중";
                } else if (coin == CoinResult.GOLD || coin == CoinResult.BLACK) {
                    lastSeenCoinResult = coin;
                    ScreenCaptureService.statusLog = "코인: " +
                            (coin == CoinResult.GOLD ? "금색" : "검정") + " (대기)";
                }
                break;
            }

            case WAITING_FIRST_SECOND: {
                // Look for cyan banner with 선공/후공 text
                if (hasCyanBanner(bitmap, w, h)) {
                    ScreenCaptureService.statusLog = "배너 감지 → OCR";
                    int bannerTop = Math.max(0, (int)(h * 0.4));
                    int bannerH = Math.min((int)(h * 0.25), h - bannerTop);
                    Bitmap banner = Bitmap.createBitmap(bitmap, 0, bannerTop, w, bannerH);
                    String text = runOCR(banner);
                    banner.recycle();

                    if (text != null) {
                        ScreenCaptureService.statusLog = "배너OCR:" + text.replace("\n", " ");
                        if (text.contains("선공")) {
                            detectionSummary += " | 선공";
                            ScreenCaptureService.statusLog = detectionSummary;
                            currentState = State.IN_DUEL;
                            lastDetectionTime = now;
                            return new AnalysisResult(DetectionType.FIRST_SECOND, "first");
                        }
                        if (text.contains("후공")) {
                            detectionSummary += " | 후공";
                            ScreenCaptureService.statusLog = detectionSummary;
                            currentState = State.IN_DUEL;
                            lastDetectionTime = now;
                            return new AnalysisResult(DetectionType.FIRST_SECOND, "second");
                        }
                    }
                }
                ScreenCaptureService.statusLog = "선후공 대기 중";
                break;
            }

            case IN_DUEL: {
                // OCR center crop for VICTORY/DEFEAT
                Bitmap center = Bitmap.createBitmap(bitmap, w / 6, h / 4, w * 2 / 3, h / 3);
                AnalysisResult r = ocrForDuelResult(center);
                center.recycle();
                if (r != null) {
                    detectionSummary += " | " + ("win".equals(r.value) ? "승리" : "패배");
                    ScreenCaptureService.statusLog = detectionSummary;
                    currentState = State.WAITING_COIN;
                    lastDetectionTime = now;
                    return r;
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
        lastSeenCoinResult = CoinResult.NONE;
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
        int radius = Math.min(w, h) / 14;
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

                if (hsv[0] > 15 && hsv[0] < 75 && hsv[1] > 0.15 && hsv[2] > 0.4) {
                    goldCount++;
                }
                if (hsv[2] < 0.12) {
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

        // No gold = back face (black coin has no warm tones)
        if (goldRatio < 0.03) return CoinResult.BLACK;

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

        return samples > 0 && (float) brightCount / samples > 0.2;
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

    // === FIRST/SECOND DETECTION ===

    /**
     * Detect cyan/teal horizontal banner in the center of screen.
     * This banner appears during "당신이 선공/후공입니다" announcement.
     */
    private static boolean hasCyanBanner(Bitmap bmp, int w, int h) {
        int cyanCount = 0;
        int samples = 0;
        int bannerY = h / 2;
        int step = Math.max(w / 40, 1);

        for (int x = w / 4; x < w * 3 / 4; x += step) {
            for (int y = bannerY - h / 15; y < bannerY + h / 15; y += step) {
                if (y < 0 || y >= h) continue;
                float[] hsv = new float[3];
                Color.colorToHSV(bmp.getPixel(x, y), hsv);
                if (hsv[0] > 160 && hsv[0] < 210 && hsv[1] > 0.2 && hsv[2] > 0.25) {
                    cyanCount++;
                }
                samples++;
            }
        }

        return samples > 0 && (float) cyanCount / samples > 0.1;
    }

    // === VICTORY/DEFEAT DETECTION (OCR) ===

    private static AnalysisResult ocrForDuelResult(Bitmap crop) {
        String text = runOCR(crop);
        if (text == null) return null;
        String upper = text.toUpperCase();

        if (upper.contains("VICTORY") || upper.contains("VICTOR") || upper.contains("ICTORY")) {
            return new AnalysisResult(DetectionType.DUEL_RESULT, "win");
        }
        if (upper.contains("DEFEAT") || upper.contains("DEFEA") || upper.contains("EFEAT")) {
            return new AnalysisResult(DetectionType.DUEL_RESULT, "lose");
        }
        return null;
    }

    private static String runOCR(Bitmap bitmap) {
        InputImage image = InputImage.fromBitmap(bitmap, 0);
        AtomicReference<String> result = new AtomicReference<>(null);
        CountDownLatch latch = new CountDownLatch(1);

        textRecognizer.process(image)
                .addOnSuccessListener(r -> { result.set(r.getText()); latch.countDown(); })
                .addOnFailureListener(e -> { Log.e(TAG, "OCR failed", e); latch.countDown(); });

        try { latch.await(2, TimeUnit.SECONDS); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); }

        return result.get();
    }
}
