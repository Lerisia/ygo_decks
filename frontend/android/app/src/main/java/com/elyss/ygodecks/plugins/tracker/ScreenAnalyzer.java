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

    private static int stableFrameCount = 0;
    private static String pendingResult = null;
    private static DetectionType pendingType = null;
    private static final int REQUIRED_STABLE_FRAMES = 2;
    private static long lastDetectionTime = 0;
    private static final long COOLDOWN_MS = 10000;

    public static AnalysisResult analyze(Bitmap bitmap) {
        long now = System.currentTimeMillis();
        if (now - lastDetectionTime < COOLDOWN_MS) {
            return null;
        }

        // 1. Check for first/second announcement (cyan banner)
        if (hasCyanBanner(bitmap)) {
            AnalysisResult fsResult = detectFirstSecond(bitmap);
            if (fsResult != null) {
                return confirmResult(fsResult);
            }
            return null;
        }

        // 2. Check duel result (WIN/LOSE)
        AnalysisResult duelResult = detectDuelResult(bitmap);
        if (duelResult != null) {
            return confirmResult(duelResult);
        }

        // 3. Check coin toss
        AnalysisResult coinResult = detectCoinToss(bitmap);
        if (coinResult != null) {
            return confirmResult(coinResult);
        }

        pendingResult = null;
        pendingType = null;
        stableFrameCount = 0;
        return null;
    }

    private static AnalysisResult confirmResult(AnalysisResult candidate) {
        if (candidate.type == pendingType && candidate.value.equals(pendingResult)) {
            stableFrameCount++;
            if (stableFrameCount >= REQUIRED_STABLE_FRAMES) {
                pendingResult = null;
                pendingType = null;
                stableFrameCount = 0;
                lastDetectionTime = System.currentTimeMillis();
                Log.d(TAG, "Confirmed: " + candidate.type + " = " + candidate.value);
                return candidate;
            }
        } else {
            pendingType = candidate.type;
            pendingResult = candidate.value;
            stableFrameCount = 1;
        }
        return null;
    }

    public static void reset() {
        stableFrameCount = 0;
        pendingResult = null;
        pendingType = null;
        lastDetectionTime = 0;
    }

    /**
     * Detect the cyan/teal horizontal banner that appears during
     * first/second player announcement.
     */
    private static boolean hasCyanBanner(Bitmap bitmap) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int bannerY = height / 2;
        int cyanCount = 0;
        int samples = 0;

        for (int x = width / 4; x < width * 3 / 4; x += 4) {
            for (int y = bannerY - 20; y < bannerY + 20; y += 4) {
                if (y < 0 || y >= height) continue;
                int pixel = bitmap.getPixel(x, y);
                float[] hsv = new float[3];
                Color.colorToHSV(pixel, hsv);

                // Cyan/teal: hue 170-200, saturated, medium-bright
                if (hsv[0] > 170 && hsv[0] < 200 && hsv[1] > 0.3 && hsv[2] > 0.3) {
                    cyanCount++;
                }
                samples++;
            }
        }

        float ratio = samples > 0 ? (float) cyanCount / samples : 0;
        return ratio > 0.15;
    }

    /**
     * Use ML Kit OCR to detect "선공" or "후공" text.
     * Only called when cyan banner is detected.
     */
    private static AnalysisResult detectFirstSecond(Bitmap bitmap) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();

        // Crop the banner area (center horizontal strip)
        int cropTop = Math.max(0, height / 2 - height / 8);
        int cropHeight = Math.min(height / 4, height - cropTop);
        Bitmap bannerArea = Bitmap.createBitmap(bitmap, 0, cropTop, width, cropHeight);

        InputImage image = InputImage.fromBitmap(bannerArea, 0);

        AtomicReference<String> detectedText = new AtomicReference<>(null);
        CountDownLatch latch = new CountDownLatch(1);

        textRecognizer.process(image)
                .addOnSuccessListener(result -> {
                    String text = result.getText();
                    Log.d(TAG, "OCR text: " + text);
                    if (text.contains("선공")) {
                        detectedText.set("first");
                    } else if (text.contains("후공")) {
                        detectedText.set("second");
                    }
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

        bannerArea.recycle();

        String value = detectedText.get();
        if (value != null) {
            return new AnalysisResult(DetectionType.FIRST_SECOND, value);
        }
        return null;
    }

    /**
     * Detect coin toss result.
     * - Spinning: purple/pink effects → ignore
     * - Landed WIN: golden center
     * - Landed LOSE: dark/black center
     */
    private static AnalysisResult detectCoinToss(Bitmap bitmap) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int coinRadius = Math.min(width, height) / 6;
        int cx = width / 2;
        int cy = height / 2;

        int purpleCount = 0;
        int goldCount = 0;
        int darkCount = 0;
        int totalSamples = 0;

        for (int y = cy - coinRadius; y < cy + coinRadius; y += 3) {
            for (int x = cx - coinRadius; x < cx + coinRadius; x += 3) {
                if (x < 0 || x >= width || y < 0 || y >= height) continue;

                int pixel = bitmap.getPixel(x, y);
                float[] hsv = new float[3];
                Color.colorToHSV(pixel, hsv);

                if (hsv[0] > 250 && hsv[0] < 340 && hsv[1] > 0.3 && hsv[2] > 0.4) {
                    purpleCount++;
                }
                if (hsv[0] > 20 && hsv[0] < 65 && hsv[1] > 0.3 && hsv[2] > 0.5) {
                    goldCount++;
                }
                if (hsv[2] < 0.15) {
                    darkCount++;
                }
                totalSamples++;
            }
        }

        if (totalSamples == 0) return null;

        float purpleRatio = (float) purpleCount / totalSamples;
        float goldRatio = (float) goldCount / totalSamples;
        float darkRatio = (float) darkCount / totalSamples;

        if (purpleRatio > 0.15) return null;

        if (darkRatio > 0.5 && goldRatio < 0.05) {
            return new AnalysisResult(DetectionType.COIN_TOSS, "lose");
        }
        if (goldRatio > 0.15 && darkRatio < 0.4) {
            return new AnalysisResult(DetectionType.COIN_TOSS, "win");
        }

        return null;
    }

    /**
     * Detect duel result using OCR.
     * VICTORY / DEFEAT text appears large in the center of the screen.
     * Language-independent detection.
     */
    private static AnalysisResult detectDuelResult(Bitmap bitmap) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();

        // Crop center area where VICTORY/DEFEAT text appears
        int cropTop = height / 4;
        int cropHeight = height / 2;
        Bitmap centerArea = Bitmap.createBitmap(bitmap, 0, cropTop, width, cropHeight);

        InputImage image = InputImage.fromBitmap(centerArea, 0);

        AtomicReference<String> detected = new AtomicReference<>(null);
        CountDownLatch latch = new CountDownLatch(1);

        textRecognizer.process(image)
                .addOnSuccessListener(result -> {
                    String text = result.getText().toUpperCase();
                    Log.d(TAG, "Duel OCR: " + text);
                    if (text.contains("VICTORY")) {
                        detected.set("win");
                    } else if (text.contains("DEFEAT")) {
                        detected.set("lose");
                    }
                    latch.countDown();
                })
                .addOnFailureListener(e -> {
                    Log.e(TAG, "Duel OCR failed", e);
                    latch.countDown();
                });

        try {
            latch.await(2, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        centerArea.recycle();

        String value = detected.get();
        if (value != null) {
            return new AnalysisResult(DetectionType.DUEL_RESULT, value);
        }
        return null;
    }
}
