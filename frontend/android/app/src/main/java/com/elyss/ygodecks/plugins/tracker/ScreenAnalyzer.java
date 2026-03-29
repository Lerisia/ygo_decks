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
    private static boolean coinScreenSeen = false;
    public static String detectionSummary = "";

    public static AnalysisResult analyze(Bitmap bitmap) {
        long now = System.currentTimeMillis();
        // Short cooldown for coin→first/second, longer for duel result
        long cooldown = (currentState == State.IN_DUEL) ? 3000 : 500;
        if (now - lastDetectionTime < cooldown) return null;

        int w = bitmap.getWidth();
        int h = bitmap.getHeight();

        switch (currentState) {
            case WAITING_COIN: {
                CoinResult coin = detectCoinWithEffects(bitmap, w, h);
                if (coin == CoinResult.SPINNING) {
                    coinScreenSeen = true;
                    ScreenCaptureService.statusLog = "코인 회전 중...";
                } else if (coin == CoinResult.GOLD && coinScreenSeen) {
                    coinScreenSeen = false;
                    detectionSummary = "코인:앞";
                    ScreenCaptureService.statusLog = detectionSummary;
                    currentState = State.WAITING_FIRST_SECOND;
                    lastDetectionTime = now;
                    return new AnalysisResult(DetectionType.COIN_TOSS, "win");
                } else if (coin == CoinResult.BLACK && coinScreenSeen) {
                    coinScreenSeen = false;
                    detectionSummary = "코인:뒤";
                    ScreenCaptureService.statusLog = detectionSummary;
                    currentState = State.WAITING_FIRST_SECOND;
                    lastDetectionTime = now;
                    return new AnalysisResult(DetectionType.COIN_TOSS, "lose");
                } else {
                    ScreenCaptureService.statusLog = "코인 대기 중";
                }
                break;
            }

            case WAITING_FIRST_SECOND: {
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
                // Try OCR for VICTORY/DEFEAT on center crop every frame
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
        coinScreenSeen = false;
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

        // Coin is spinning (purple effects visible)
        if (purpleRatio > 0.15) return CoinResult.SPINNING;

        // Coin has landed
        if (goldRatio > 0.25) return CoinResult.GOLD;
        if (darkRatio > 0.5) return CoinResult.BLACK;

        return CoinResult.NONE;
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

    private static boolean hasBrightCenter(Bitmap bmp, int w, int h) {
        int brightCount = 0;
        int samples = 0;
        int startY = (int)(h * 0.3);
        int endY = (int)(h * 0.55);
        int step = Math.max(w / 40, 1);

        for (int y = startY; y < endY; y += step) {
            for (int x = w / 4; x < w * 3 / 4; x += step) {
                int pixel = bmp.getPixel(x, y);
                if (Color.red(pixel) > 200 && Color.green(pixel) > 200 && Color.blue(pixel) > 200) {
                    brightCount++;
                }
                samples++;
            }
        }

        return samples > 0 && (float) brightCount / samples > 0.1;
    }

    private static AnalysisResult ocrForDuelResult(Bitmap crop) {
        String text = runOCR(crop);
        if (text == null) return null;
        String upper = text.toUpperCase();
        ScreenCaptureService.statusLog = "결과OCR:" + upper.substring(0, Math.min(30, upper.length()));

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
