package com.elyss.ygodecks.plugins.tracker;

import android.graphics.Bitmap;
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

        // Run all OCR on the full screen at once
        AnalysisResult result = detectAllViaOCR(bitmap);
        if (result != null) {
            return confirmResult(result);
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
     * Single OCR pass on the full screen.
     * Detects all events from one text recognition result.
     */
    private static AnalysisResult detectAllViaOCR(Bitmap bitmap) {
        InputImage image = InputImage.fromBitmap(bitmap, 0);

        AtomicReference<AnalysisResult> detected = new AtomicReference<>(null);
        CountDownLatch latch = new CountDownLatch(1);

        textRecognizer.process(image)
                .addOnSuccessListener(result -> {
                    String text = result.getText();
                    String upper = text.toUpperCase();
                    String preview = text.replace("\n", " ").trim();
                    if (preview.length() > 80) preview = preview.substring(0, 80);
                    ScreenCaptureService.statusLog = "OCR:" + (preview.isEmpty() ? "(빈텍스트)" : preview);
                    Log.d(TAG, "OCR full: " + text.replace("\n", " | "));

                    // Priority 1: Duel result
                    if (upper.contains("VICTORY")) {
                        detected.set(new AnalysisResult(DetectionType.DUEL_RESULT, "win"));
                    } else if (upper.contains("DEFEAT")) {
                        detected.set(new AnalysisResult(DetectionType.DUEL_RESULT, "lose"));
                    }
                    // Priority 2: First/second announcement
                    else if (text.contains("당신이") && text.contains("선공")) {
                        detected.set(new AnalysisResult(DetectionType.FIRST_SECOND, "first"));
                    } else if (text.contains("당신이") && text.contains("후공")) {
                        detected.set(new AnalysisResult(DetectionType.FIRST_SECOND, "second"));
                    }
                    // Priority 3: Coin toss
                    else if (text.contains("선택해주세요") || text.contains("선택해 주세요")) {
                        detected.set(new AnalysisResult(DetectionType.COIN_TOSS, "win"));
                    } else if (text.contains("상대가") && text.contains("선택")) {
                        detected.set(new AnalysisResult(DetectionType.COIN_TOSS, "lose"));
                    }

                    latch.countDown();
                })
                .addOnFailureListener(e -> {
                    ScreenCaptureService.statusLog = "OCR실패:" + e.getMessage();
                    Log.e(TAG, "OCR failed", e);
                    latch.countDown();
                });

        try {
            latch.await(3, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        return detected.get();
    }
}
