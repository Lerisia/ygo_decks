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

    public enum DetectionType {
        COIN_TOSS,
        FIRST_SECOND,
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

    private static long lastDetectionTime = 0;
    private static final long COOLDOWN_MS = 5000;

    public static AnalysisResult analyze(Bitmap bitmap) {
        long now = System.currentTimeMillis();
        if (now - lastDetectionTime < COOLDOWN_MS) {
            return null;
        }

        int w = bitmap.getWidth();
        int h = bitmap.getHeight();

        // Step 1: Check for bright center (VICTORY/DEFEAT screen)
        if (hasBrightCenter(bitmap, w, h)) {
            ScreenCaptureService.statusLog = "밝은 중앙 감지 → OCR";
            Bitmap center = Bitmap.createBitmap(bitmap, 0, h / 4, w, h / 2);
            AnalysisResult r = ocrForDuelResult(center);
            center.recycle();
            if (r != null) {
                lastDetectionTime = now;
                return r;
            }
        }

        // Step 2: Check turn button color for first/second (blue = first, red = second)
        TurnColor turnColor = detectTurnButtonColor(bitmap, w, h);
        if (turnColor != TurnColor.NONE) {
            String value = (turnColor == TurnColor.BLUE) ? "first" : "second";
            ScreenCaptureService.statusLog = "턴버튼: " + (turnColor == TurnColor.BLUE ? "파랑(선공)" : "빨강(후공)");
            lastDetectionTime = now;
            return new AnalysisResult(DetectionType.FIRST_SECOND, value);
        }

        // Step 3: Check coin toss by center color (gold = win, black = lose)
        CoinColor coinColor = detectCoinColor(bitmap, w, h);
        if (coinColor != CoinColor.NONE) {
            String value = (coinColor == CoinColor.GOLD) ? "win" : "lose";
            ScreenCaptureService.statusLog = "코인감지: " + (coinColor == CoinColor.GOLD ? "금색(앞)" : "검정(뒤)");
            lastDetectionTime = now;
            return new AnalysisResult(DetectionType.COIN_TOSS, value);
        }

        ScreenCaptureService.statusLog = "스캔 중";
        return null;
    }

    public static void reset() {
        lastDetectionTime = 0;
    }

    /**
     * Check if center of screen has many bright pixels (VICTORY/DEFEAT text).
     * These screens have large white/silver text in the center.
     */
    private static boolean hasBrightCenter(Bitmap bmp, int w, int h) {
        int brightCount = 0;
        int samples = 0;
        int startY = (int)(h * 0.3);
        int endY = (int)(h * 0.55);
        int step = Math.max(w / 40, 1);

        for (int y = startY; y < endY; y += step) {
            for (int x = w / 4; x < w * 3 / 4; x += step) {
                int pixel = bmp.getPixel(x, y);
                int r = Color.red(pixel);
                int g = Color.green(pixel);
                int b = Color.blue(pixel);
                if (r > 200 && g > 200 && b > 200) {
                    brightCount++;
                }
                samples++;
            }
        }

        float ratio = samples > 0 ? (float) brightCount / samples : 0;
        return ratio > 0.08;
    }

    private enum TurnColor { NONE, BLUE, RED }

    /**
     * Detect turn button color on the right side of the game board.
     * Blue = player's turn (first), Red = opponent's turn (second).
     * Only meaningful on Turn 1 (game start).
     * The turn indicator is roughly at x: 70-90%, y: 40-55% of screen.
     */
    private static TurnColor detectTurnButtonColor(Bitmap bmp, int w, int h) {
        int startX = (int)(w * 0.7);
        int endX = (int)(w * 0.92);
        int startY = (int)(h * 0.38);
        int endY = (int)(h * 0.58);
        int step = Math.max((endX - startX) / 15, 1);

        int blueCount = 0;
        int redCount = 0;
        int samples = 0;

        for (int y = startY; y < endY; y += step) {
            for (int x = startX; x < endX; x += step) {
                if (x >= w || y >= h) continue;
                float[] hsv = new float[3];
                Color.colorToHSV(bmp.getPixel(x, y), hsv);

                // Blue/cyan hue (180-240), saturated
                if (hsv[0] > 180 && hsv[0] < 240 && hsv[1] > 0.3 && hsv[2] > 0.3) {
                    blueCount++;
                }
                // Red hue (340-360 or 0-20), saturated
                if ((hsv[0] > 340 || hsv[0] < 20) && hsv[1] > 0.3 && hsv[2] > 0.3) {
                    redCount++;
                }
                samples++;
            }
        }

        if (samples == 0) return TurnColor.NONE;

        float blueRatio = (float) blueCount / samples;
        float redRatio = (float) redCount / samples;

        // Need a meaningful amount of blue or red
        if (blueRatio > 0.15 && blueRatio > redRatio * 2) return TurnColor.BLUE;
        if (redRatio > 0.15 && redRatio > blueRatio * 2) return TurnColor.RED;

        return TurnColor.NONE;
    }

    private enum CoinColor { NONE, GOLD, BLACK }

    /**
     * Detect coin toss result by center color.
     * Gold/warm center = front face (win), very dark center = back face (lose).
     * Ignore if purple/pink effects present (still spinning).
     */
    private static CoinColor detectCoinColor(Bitmap bmp, int w, int h) {
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

                // Gold/warm: hue 20-60, saturated, bright
                if (hsv[0] > 15 && hsv[0] < 65 && hsv[1] > 0.25 && hsv[2] > 0.4) {
                    goldCount++;
                }
                // Very dark (coin back)
                if (hsv[2] < 0.1) {
                    darkCount++;
                }
                // Purple/pink effects (spinning)
                if (hsv[0] > 250 && hsv[0] < 340 && hsv[1] > 0.3 && hsv[2] > 0.3) {
                    purpleCount++;
                }
                samples++;
            }
        }

        if (samples == 0) return CoinColor.NONE;

        float purpleRatio = (float) purpleCount / samples;
        float goldRatio = (float) goldCount / samples;
        float darkRatio = (float) darkCount / samples;

        // Still spinning
        if (purpleRatio > 0.15) return CoinColor.NONE;

        if (goldRatio > 0.2) return CoinColor.GOLD;
        if (darkRatio > 0.5) return CoinColor.BLACK;

        return CoinColor.NONE;
    }

    /**
     * OCR small cropped region for VICTORY/DEFEAT.
     */
    private static AnalysisResult ocrForDuelResult(Bitmap crop) {
        String text = runOCR(crop);
        if (text == null) return null;
        String upper = text.toUpperCase();
        ScreenCaptureService.statusLog = "결과OCR:" + upper.substring(0, Math.min(40, upper.length()));

        if (upper.contains("VICTORY") || upper.contains("VICTOR") || upper.contains("ICTORY")) {
            return new AnalysisResult(DetectionType.DUEL_RESULT, "win");
        }
        if (upper.contains("DEFEAT") || upper.contains("DEFEA") || upper.contains("EFEAT")) {
            return new AnalysisResult(DetectionType.DUEL_RESULT, "lose");
        }
        return null;
    }

    /**
     * OCR small cropped banner for 선공/후공.
     */
    /**
     * Run ML Kit OCR on a bitmap and return text.
     */
    private static String runOCR(Bitmap bitmap) {
        InputImage image = InputImage.fromBitmap(bitmap, 0);
        AtomicReference<String> result = new AtomicReference<>(null);
        CountDownLatch latch = new CountDownLatch(1);

        textRecognizer.process(image)
                .addOnSuccessListener(r -> {
                    result.set(r.getText());
                    latch.countDown();
                })
                .addOnFailureListener(e -> {
                    Log.e(TAG, "OCR failed", e);
                    latch.countDown();
                });

        try {
            latch.await(2, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        return result.get();
    }
}
