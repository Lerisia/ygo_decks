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

        // Step 2: Check for cyan banner (first/second announcement)
        if (hasCyanBanner(bitmap, w, h)) {
            ScreenCaptureService.statusLog = "청록 배너 감지 → OCR";
            int bannerTop = Math.max(0, (int)(h * 0.4));
            int bannerH = Math.min((int)(h * 0.2), h - bannerTop);
            Bitmap banner = Bitmap.createBitmap(bitmap, 0, bannerTop, w, bannerH);
            AnalysisResult r = ocrForFirstSecond(banner);
            banner.recycle();
            if (r != null) {
                lastDetectionTime = now;
                return r;
            }
        }

        // Step 3: Check for coin toss screen (lower half text)
        // OCR the lower portion for "선택해" or "상대가"
        if (hasGameUI(bitmap, w, h)) {
            int cropTop = (int)(h * 0.45);
            int cropH = Math.min((int)(h * 0.25), h - cropTop);
            Bitmap lower = Bitmap.createBitmap(bitmap, 0, cropTop, w, cropH);
            AnalysisResult r = ocrForCoinToss(lower);
            lower.recycle();
            if (r != null) {
                lastDetectionTime = now;
                return r;
            }
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

    /**
     * Check for cyan/teal horizontal banner in the middle of screen.
     */
    private static boolean hasCyanBanner(Bitmap bmp, int w, int h) {
        int cyanCount = 0;
        int samples = 0;
        int bannerY = h / 2;
        int step = Math.max(w / 50, 1);

        for (int x = w / 4; x < w * 3 / 4; x += step) {
            for (int y = bannerY - h / 20; y < bannerY + h / 20; y += step) {
                if (y < 0 || y >= h) continue;
                float[] hsv = new float[3];
                Color.colorToHSV(bmp.getPixel(x, y), hsv);
                if (hsv[0] > 160 && hsv[0] < 210 && hsv[1] > 0.25 && hsv[2] > 0.3) {
                    cyanCount++;
                }
                samples++;
            }
        }

        float ratio = samples > 0 ? (float) cyanCount / samples : 0;
        return ratio > 0.12;
    }

    /**
     * Check if screen looks like game UI (dark background with UI elements).
     * Simple heuristic to avoid running OCR on random screens.
     */
    private static boolean hasGameUI(Bitmap bmp, int w, int h) {
        int darkCount = 0;
        int samples = 0;
        int step = Math.max(w / 20, 1);

        for (int y = 0; y < h; y += step * 3) {
            for (int x = 0; x < w; x += step * 3) {
                float[] hsv = new float[3];
                Color.colorToHSV(bmp.getPixel(x, y), hsv);
                if (hsv[2] < 0.3) darkCount++;
                samples++;
            }
        }

        float ratio = samples > 0 ? (float) darkCount / samples : 0;
        return ratio > 0.4;
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
    private static AnalysisResult ocrForFirstSecond(Bitmap crop) {
        String text = runOCR(crop);
        if (text == null) return null;
        ScreenCaptureService.statusLog = "배너OCR:" + text.replace("\n", " ").substring(0, Math.min(40, text.length()));

        if (text.contains("선공입니다") || text.contains("선공 입니다") || text.contains("선공입")) {
            return new AnalysisResult(DetectionType.FIRST_SECOND, "first");
        }
        if (text.contains("후공입니다") || text.contains("후공 입니다") || text.contains("후공입")) {
            return new AnalysisResult(DetectionType.FIRST_SECOND, "second");
        }
        return null;
    }

    /**
     * OCR small cropped region for coin toss.
     */
    private static AnalysisResult ocrForCoinToss(Bitmap crop) {
        String text = runOCR(crop);
        if (text == null) return null;
        ScreenCaptureService.statusLog = "코인OCR:" + text.replace("\n", " ").substring(0, Math.min(40, text.length()));

        if (text.contains("선택해")) {
            return new AnalysisResult(DetectionType.COIN_TOSS, "win");
        }
        if (text.contains("상대가")) {
            return new AnalysisResult(DetectionType.COIN_TOSS, "lose");
        }
        return null;
    }

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
