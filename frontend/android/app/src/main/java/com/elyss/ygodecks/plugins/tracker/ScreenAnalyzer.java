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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class ScreenAnalyzer {

    private static final String TAG = "ScreenAnalyzer";
    private static final TextRecognizer textRecognizer =
            TextRecognition.getClient(new KoreanTextRecognizerOptions.Builder().build());

    public enum DetectionType { COIN_TOSS, FIRST_SECOND, DUEL_RESULT, RATING_SCORE }
    public enum State { WAITING_MATCH_START, IN_DUEL, WAITING_RATING }

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

    // Coin tracking
    private enum CoinResult { NONE, GOLD, BLACK }
    private static CoinResult lastSeenCoin = CoinResult.NONE;

    // Pending first/second to return on next poll
    public static String pendingFirstSecond = null;

    // Tracking mode: "rank", "rating", "none"
    public static String trackingMode = "none";

    // Rating state
    private static long waitingRatingStart = 0;
    private static final long RATING_TIMEOUT_MS = 60_000;
    private static String pendingDuelResult = null;

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

                // 2. Try OCR for 선공/후공
                int cropTop = (int)(h * 0.4);
                int cropH = Math.min((int)(h * 0.35), h - cropTop);
                Bitmap textArea = Bitmap.createBitmap(bitmap, 0, cropTop, w, cropH);
                String text = runOCR(textArea);
                textArea.recycle();

                String coinStr = lastSeenCoin == CoinResult.GOLD ? "앞" :
                                 lastSeenCoin == CoinResult.BLACK ? "뒤" : "?";

                if (text != null) {
                    String fsValue = null;
                    if (!text.contains("선택") && text.contains("입니다")) {
                        if (text.contains("후공") || text.contains("후 공")) {
                            fsValue = "second";
                        } else if (text.contains("선공") || text.contains("선 공")) {
                            fsValue = "first";
                        }
                    }

                    if (fsValue != null) {
                        String coinVal = (lastSeenCoin == CoinResult.GOLD) ? "win" : "lose";
                        detectionSummary = "코인:" + coinStr + " | " +
                                ("first".equals(fsValue) ? "선공" : "후공");

                        pendingFirstSecond = fsValue;
                        currentState = State.IN_DUEL;
                        lastSeenCoin = CoinResult.NONE;
                        lastDetectionTime = now;
                        return new AnalysisResult(DetectionType.COIN_TOSS, coinVal);
                    }
                }
                break;
            }

            case IN_DUEL: {
                Bitmap center = Bitmap.createBitmap(bitmap, w / 6, h / 4, w * 2 / 3, h / 3);
                AnalysisResult r = ocrForDuelResult(center);
                center.recycle();
                if (r != null) {
                    detectionSummary += " | " + ("win".equals(r.value) ? "승리" : "패배");
                    lastDetectionTime = now;

                    if ("rating".equals(trackingMode)) {
                        // Don't return yet — wait for rating screen
                        pendingDuelResult = r.value;
                        currentState = State.WAITING_RATING;
                        waitingRatingStart = now;
                        return r;  // Still return DUEL_RESULT so service knows win/lose
                    } else {
                        currentState = State.WAITING_MATCH_START;
                        detectionSummary = "";
                        return r;
                    }
                }
                break;
            }

            case WAITING_RATING: {
                // Timeout check
                if (now - waitingRatingStart > RATING_TIMEOUT_MS) {
                    currentState = State.WAITING_MATCH_START;
                    pendingDuelResult = null;
                    detectionSummary = "";
                    break;
                }

                // OCR the center area for rating screen
                int cropTop = (int)(h * 0.3);
                int cropH = Math.min((int)(h * 0.4), h - cropTop);
                Bitmap ratingArea = Bitmap.createBitmap(bitmap, 0, cropTop, w, cropH);
                String text = runOCR(ratingArea);
                ratingArea.recycle();

                if (text != null && (text.contains("레이팅") || text.contains("매치 결과"))) {
                    // Parse the score — look for the last number (after >>> or last on line)
                    String score = parseRatingScore(text);
                    if (score != null) {
                        currentState = State.WAITING_MATCH_START;
                        pendingDuelResult = null;
                        detectionSummary = "";
                        lastDetectionTime = now;
                        return new AnalysisResult(DetectionType.RATING_SCORE, score);
                    }
                }
                break;
            }
        }

        return null;
    }

    // Parse the final rating score (integer part only)
    private static String parseRatingScore(String text) {
        // Look for numbers with optional decimal, take the last one (result score)
        Pattern p = Pattern.compile("(\\d{3,5})\\.?\\d*");
        Matcher m = p.matcher(text.replace(",", "").replace(" ", ""));
        String lastMatch = null;
        while (m.find()) {
            lastMatch = m.group(1);
        }
        return lastMatch;
    }

    public static State getCurrentState() { return currentState; }

    public static void reset() {
        currentState = State.WAITING_MATCH_START;
        lastDetectionTime = 0;
        lastSeenCoin = CoinResult.NONE;
        pendingFirstSecond = null;
        pendingDuelResult = null;
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
