package com.elyss.ygodecks.plugins.tracker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.WindowManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.nio.ByteBuffer;

public class ScreenCaptureService extends Service {

    private static final String TAG = "DuelTracker";
    private static final String CHANNEL_ID = "duel_tracker_channel";
    private static final int NOTIFICATION_ID = 1001;
    private static final long CAPTURE_INTERVAL_MS = 4000;

    public static volatile String lastCoinToss = null;
    public static volatile String lastFirstSecond = null;
    public static volatile String lastDuelResult = null;
    public static volatile long lastDetectionTime = 0;
    public static volatile String statusLog = "";

    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private Handler mainHandler;
    private Runnable captureRunnable;
    private boolean isCapturing = false;
    private DetectionOverlay overlay;
    private int captureCount = 0;
    private int captureWidth = 540;
    private int captureHeight = 1200;
    private int captureDensity = 210;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        statusLog = "onCreate 진입";
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        statusLog = "onStartCommand 진입";

        // Step 1: Notification channel
        try {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "듀얼 트래커", NotificationManager.IMPORTANCE_DEFAULT);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
            statusLog = "채널 생성됨";
        } catch (Exception e) {
            statusLog = "채널 실패: " + e;
            Log.e(TAG, statusLog, e);
            stopSelf();
            return START_NOT_STICKY;
        }

        // Step 2: startForeground
        try {
            Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setContentTitle("YGODecks 트래커")
                    .setContentText("시작됨")
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setOngoing(true)
                    .build();

            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFICATION_ID, notification,
                        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            statusLog = "포그라운드 OK";
            Log.d(TAG, statusLog);
        } catch (Exception e) {
            statusLog = "포그라운드 실패: " + e;
            Log.e(TAG, statusLog, e);
            stopSelf();
            return START_NOT_STICKY;
        }

        // Step 3: Intent data
        if (intent == null) {
            statusLog = "intent null";
            stopSelf();
            return START_NOT_STICKY;
        }

        int resultCode = intent.getIntExtra("resultCode", -1);
        Intent data;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            data = intent.getParcelableExtra("data", Intent.class);
        } else {
            data = intent.getParcelableExtra("data");
        }
        if (data == null || resultCode == -1) {
            statusLog = "데이터 없음 rc=" + resultCode + " data=" + (data == null ? "null" : "ok");
            updateNotification(statusLog);
            stopSelf();
            return START_NOT_STICKY;
        }

        // Step 4: MediaProjection
        try {
            MediaProjectionManager mgr = (MediaProjectionManager)
                    getSystemService(MEDIA_PROJECTION_SERVICE);
            mediaProjection = mgr.getMediaProjection(resultCode, data);
            if (mediaProjection == null) {
                statusLog = "projection null";
                updateNotification(statusLog);
                stopSelf();
                return START_NOT_STICKY;
            }
            statusLog = "projection OK";
            updateNotification(statusLog);
        } catch (Exception e) {
            statusLog = "projection 실패: " + e;
            updateNotification(statusLog);
            Log.e(TAG, statusLog, e);
            stopSelf();
            return START_NOT_STICKY;
        }

        // Step 5: Init helpers
        mainHandler = new Handler(getMainLooper());
        captureThread = new HandlerThread("Capture");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());

        try {
            overlay = new DetectionOverlay(this);
        } catch (Exception e) {
            Log.w(TAG, "overlay init fail", e);
        }

        try {
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            DisplayMetrics m = new DisplayMetrics();
            wm.getDefaultDisplay().getRealMetrics(m);
            captureWidth = m.widthPixels / 2;
            captureHeight = m.heightPixels / 2;
            captureDensity = m.densityDpi / 2;
        } catch (Exception e) {
            Log.w(TAG, "metrics fail", e);
        }

        // Step 6: Start capture
        try {
            startCapture();
            statusLog = "감지 중";
            updateNotification("듀얼을 감지하고 있습니다");
        } catch (Exception e) {
            statusLog = "캡처 실패: " + e;
            updateNotification(statusLog);
            Log.e(TAG, statusLog, e);
        }

        return START_STICKY;
    }

    private void startCapture() {
        imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2);
        virtualDisplay = mediaProjection.createVirtualDisplay(
                "DuelTracker", captureWidth, captureHeight, captureDensity,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(), null, captureHandler);
        isCapturing = true;
        captureRunnable = () -> {
            if (!isCapturing) return;
            captureAndAnalyze();
            captureHandler.postDelayed(captureRunnable, CAPTURE_INTERVAL_MS);
        };
        captureHandler.postDelayed(captureRunnable, 2000);
    }

    private void updateNotification(String text) {
        try {
            Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setContentTitle("YGODecks 트래커")
                    .setContentText(text)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setOngoing(true)
                    .build();
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, n);
        } catch (Exception ignored) {}
    }

    private void captureAndAnalyze() {
        if (imageReader == null) return;
        Image image;
        try { image = imageReader.acquireLatestImage(); } catch (Exception e) { return; }
        if (image == null) return;

        captureCount++;
        statusLog = "스캔 " + captureCount + "회";
        if (captureCount % 3 == 0) updateNotification("감지 중 (" + captureCount + "회)");

        try {
            Image.Plane[] planes = image.getPlanes();
            ByteBuffer buffer = planes[0].getBuffer();
            int pixelStride = planes[0].getPixelStride();
            int rowStride = planes[0].getRowStride();
            int rowPadding = rowStride - pixelStride * captureWidth;

            Bitmap bitmap = Bitmap.createBitmap(
                    captureWidth + rowPadding / pixelStride, captureHeight, Bitmap.Config.ARGB_8888);
            bitmap.copyPixelsFromBuffer(buffer);

            Bitmap cropped = (rowPadding > 0)
                    ? Bitmap.createBitmap(bitmap, 0, 0, captureWidth, captureHeight) : bitmap;

            ScreenAnalyzer.AnalysisResult result = ScreenAnalyzer.analyze(cropped);
            if (result != null) {
                lastDetectionTime = System.currentTimeMillis();
                String msg = "";
                switch (result.type) {
                    case COIN_TOSS:
                        lastCoinToss = result.value;
                        msg = "코인토스: " + ("win".equals(result.value) ? "앞면" : "뒷면");
                        break;
                    case FIRST_SECOND:
                        lastFirstSecond = result.value;
                        msg = "first".equals(result.value) ? "선공" : "후공";
                        break;
                    case DUEL_RESULT:
                        lastDuelResult = result.value;
                        msg = "win".equals(result.value) ? "승리" : "패배";
                        break;
                }
                statusLog = msg;
                updateNotification(msg);
                if (overlay != null) {
                    final String m = msg;
                    mainHandler.post(() -> overlay.show(m));
                }
            }

            if (cropped != bitmap) cropped.recycle();
            bitmap.recycle();
        } catch (Exception e) {
            statusLog = "분석 오류: " + e.getMessage();
            Log.e(TAG, statusLog, e);
        } finally {
            image.close();
        }
    }

    @Override
    public void onDestroy() {
        isCapturing = false;
        if (captureHandler != null && captureRunnable != null) captureHandler.removeCallbacks(captureRunnable);
        if (virtualDisplay != null) virtualDisplay.release();
        if (imageReader != null) imageReader.close();
        if (mediaProjection != null) mediaProjection.stop();
        if (captureThread != null) captureThread.quitSafely();
        if (overlay != null) overlay.dismiss();
        lastCoinToss = null; lastFirstSecond = null; lastDuelResult = null;
        lastDetectionTime = 0;
        statusLog = "종료:" + statusLog;
        super.onDestroy();
    }
}
