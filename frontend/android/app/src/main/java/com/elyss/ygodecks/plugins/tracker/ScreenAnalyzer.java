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
    public enum State { WAITING_MATCH_START, IN_DUEL }

    public static class AnalysisResult {
        public DetectionType type;
        public String value;
        public AnalysisResult(DetectionType type, String value) {
            this.type = type;
            this.value = value;
        }
    }

    private static State currentState = State.WAITING_MATCH_START;
    private static long lastDetectionTime = 0;
    public static String detectionSummary = "";

    // Coin tracking - continuously updated, confirmed when first/second is detected
    private enum CoinResult { NONE, GOLD, BLACK }
    private static CoinResult lastSeenCoin = CoinResult.NONE;

    // Pending first/second to return on next poll
    public static String pendingFirstSecond = null;

    public static AnalysisResult analyze(Bitmap bitmap) {
        long now = System.currentTimeMillis();
        if (now - lastDetectionTime < 500) return null;

        int w = bitmap.getWidth();
        int h = bitmap.getHeight();

        // Return pending first/second from previous detection
        if (pendingFirstSecond != null) {
            String fs = pendingFirstSecond;
            pendingFirstSecond = null;
            lastDetectionTime = now;
            return new AnalysisResult(DetectionType.FIRST_SECOND, fs);
        }

        switch (currentState) {
            case WAITING_MATCH_START: {
                // 1. Continuously track coin color (gold/black)
                updateCoinColor(bitmap, w, h);

                // 2. Try OCR for 선공/후공 - when found, confirm coin + first/second
                int cropTop = (int)(h * 0.4);
                int cropH = Math.min((int)(h * 0.35), h - cropTop);
                Bitmap textArea = Bitmap.createBitmap(bitmap, 0, cropTop, w, cropH);
                String text = runOCR(textArea);
                textArea.recycle();

                String coinStr = lastSeenCoin == CoinResult.GOLD ? "앞" :
                                 lastSeenCoin == CoinResult.BLACK ? "뒤" : "?";

                if (text != null) {
                    String preview = text.replace("\n", " ").trim();
                    if (preview.length() > 30) preview = preview.substring(0, 30);
                    ScreenCaptureService.statusLog = "코인:" + coinStr + " OCR:" + preview;

                    String fsValue = null;
                    // Exclude selection screen ("선공 / 후공을 선택해주세요")
                    if (!text.contains("선택")) {
                        if (text.contains("입니다") && (text.contains("선공") || text.contains("선 공") || text.contains("선"))) {
                            fsValue = "first";
                        } else if (text.contains("입니다") && (text.contains("후공") || text.contains("후 공") || text.contains("후"))) {
                            fsValue = "second";
                        }
                    }

                    if (fsValue != null) {
                        // Confirm coin at this moment + transition to duel
                        String coinVal = (lastSeenCoin == CoinResult.GOLD) ? "win" : "lose";
                        detectionSummary = "코인:" + coinStr + " | " +
                                ("first".equals(fsValue) ? "선공" : "후공");
                        ScreenCaptureService.statusLog = detectionSummary;

                        pendingFirstSecond = fsValue;
                        currentState = State.IN_DUEL;
                        lastSeenCoin = CoinResult.NONE;
                        lastDetectionTime = now;
                        return new AnalysisResult(DetectionType.COIN_TOSS, coinVal);
                    }
                } else {
                    ScreenCaptureService.statusLog = "대기 코인:" + coinStr;
                }
                break;
            }

            case IN_DUEL: {
                // OCR for VICTORY/DEFEAT
                Bitmap center = Bitmap.createBitmap(bitmap, w / 6, h / 4, w * 2 / 3, h / 3);
                AnalysisResult r = ocrForDuelResult(center);
                center.recycle();
                if (r != null) {
                    detectionSummary += " | " + ("win".equals(r.value) ? "승리" : "패배");
                    ScreenCaptureService.statusLog = detectionSummary;
                    currentState = State.WAITING_MATCH_START;
                    detectionSummary = "";
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
        currentState = State.WAITING_MATCH_START;
        lastDetectionTime = 0;
        lastSeenCoin = CoinResult.NONE;
        pendingFirstSecond = null;
        detectionSummary = "";
    }

    // === COIN COLOR TRACKING ===

    private static void updateCoinColor(Bitmap bmp, int w, int h) {
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
                if (hsv[2] < 0.25) {
                    darkCount++;
                }
                if (hsv[0] > 250 && hsv[0] < 340 && hsv[1] > 0.25 && hsv[2] > 0.25) {
                    purpleCount++;
                }
                samples++;
            }
        }

        if (samples == 0) return;

        float purpleRatio = (float) purpleCount / samples;
        float goldRatio = (float) goldCount / samples;
        float darkRatio = (float) darkCount / samples;

        // Only update when on coin screen (purple present)
        if (purpleRatio < 0.05) return;

        if (goldRatio > 0.10) {
            lastSeenCoin = CoinResult.GOLD;
        } else if (goldRatio < 0.03 && darkRatio > 0.10) {
            lastSeenCoin = CoinResult.BLACK;
        }
    }

    // === VICTORY/DEFEAT OCR ===

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
