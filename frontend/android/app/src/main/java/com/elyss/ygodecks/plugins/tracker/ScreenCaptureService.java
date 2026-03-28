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

    @Override
    public void onCreate() {
        super.onCreate();

        // Notification channel + startForeground FIRST, before anything else
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "듀얼 트래커", NotificationManager.IMPORTANCE_LOW);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("YGODecks 트래커")
                .setContentText("초기화 중...")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setOngoing(true)
                .build();

        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFICATION_ID, notification,
                        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            statusLog = "startForeground 실패: " + e.getMessage();
            Log.e(TAG, statusLog, e);
            stopSelf();
            return;
        }

        statusLog = "서비스 시작됨";
        updateNotification(statusLog);

        // Now safe to initialize everything else
        mainHandler = new Handler(getMainLooper());

        captureThread = new HandlerThread("DuelTrackerCapture");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());

        try {
            overlay = new DetectionOverlay(this);
        } catch (Exception e) {
            Log.w(TAG, "Overlay init failed", e);
        }

        try {
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            DisplayMetrics metrics = new DisplayMetrics();
            wm.getDefaultDisplay().getRealMetrics(metrics);
            captureWidth = metrics.widthPixels / 2;
            captureHeight = metrics.heightPixels / 2;
            captureDensity = metrics.densityDpi / 2;
        } catch (Exception e) {
            Log.w(TAG, "Display metrics failed, using defaults", e);
        }

        statusLog = "초기화 완료 (" + captureWidth + "x" + captureHeight + ")";
        updateNotification(statusLog);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        int resultCode = intent.getIntExtra("resultCode", -1);
        Intent data = intent.getParcelableExtra("data");

        if (data == null || resultCode == -1) {
            statusLog = "MediaProjection 데이터 없음";
            updateNotification(statusLog);
            stopSelf();
            return START_NOT_STICKY;
        }

        try {
            MediaProjectionManager mgr = (MediaProjectionManager)
                    getSystemService(MEDIA_PROJECTION_SERVICE);
            mediaProjection = mgr.getMediaProjection(resultCode, data);

            if (mediaProjection == null) {
                statusLog = "MediaProjection 획득 실패";
                updateNotification(statusLog);
                stopSelf();
                return START_NOT_STICKY;
            }

            startCapture();
        } catch (Exception e) {
            statusLog = "캡처 시작 실패: " + e.getMessage();
            updateNotification(statusLog);
            Log.e(TAG, statusLog, e);
            stopSelf();
            return START_NOT_STICKY;
        }

        return START_STICKY;
    }

    private void startCapture() {
        imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2);

        virtualDisplay = mediaProjection.createVirtualDisplay(
                "DuelTracker",
                captureWidth, captureHeight, captureDensity,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null, captureHandler
        );

        isCapturing = true;

        captureRunnable = new Runnable() {
            @Override
            public void run() {
                if (!isCapturing) return;
                captureAndAnalyze();
                captureHandler.postDelayed(this, CAPTURE_INTERVAL_MS);
            }
        };
        captureHandler.postDelayed(captureRunnable, 2000);

        statusLog = "감지 중";
        updateNotification("듀얼을 감지하고 있습니다");
    }

    private void updateNotification(String text) {
        try {
            Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setContentTitle("YGODecks 트래커")
                    .setContentText(text)
                    .setSmallIcon(android.R.drawable.ic_media_play)
                    .setOngoing(true)
                    .build();
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification);
        } catch (Exception ignored) {}
    }

    private void captureAndAnalyze() {
        if (imageReader == null) return;

        Image image;
        try {
            image = imageReader.acquireLatestImage();
        } catch (Exception e) {
            return;
        }
        if (image == null) return;

        captureCount++;
        statusLog = "스캔 " + captureCount + "회";
        if (captureCount % 3 == 0) {
            updateNotification("감지 중 (" + captureCount + "회 스캔)");
        }

        try {
            Image.Plane[] planes = image.getPlanes();
            ByteBuffer buffer = planes[0].getBuffer();
            int pixelStride = planes[0].getPixelStride();
            int rowStride = planes[0].getRowStride();
            int rowPadding = rowStride - pixelStride * captureWidth;

            Bitmap bitmap = Bitmap.createBitmap(
                    captureWidth + rowPadding / pixelStride,
                    captureHeight,
                    Bitmap.Config.ARGB_8888
            );
            bitmap.copyPixelsFromBuffer(buffer);

            Bitmap cropped = (rowPadding > 0)
                    ? Bitmap.createBitmap(bitmap, 0, 0, captureWidth, captureHeight)
                    : bitmap;

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
                        msg = ("win".equals(result.value) ? "승리" : "패배");
                        break;
                }

                statusLog = msg;
                updateNotification(msg);
                if (overlay != null) {
                    final String overlayMsg = msg;
                    mainHandler.post(() -> overlay.show(overlayMsg));
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

    private void stopCapture() {
        isCapturing = false;
        if (captureHandler != null && captureRunnable != null) {
            captureHandler.removeCallbacks(captureRunnable);
        }
        if (virtualDisplay != null) { virtualDisplay.release(); virtualDisplay = null; }
        if (imageReader != null) { imageReader.close(); imageReader = null; }
        if (mediaProjection != null) { mediaProjection.stop(); mediaProjection = null; }
        if (captureThread != null) { captureThread.quitSafely(); captureThread = null; }
    }

    @Override
    public void onDestroy() {
        stopCapture();
        if (overlay != null) overlay.dismiss();
        lastCoinToss = null;
        lastFirstSecond = null;
        lastDuelResult = null;
        lastDetectionTime = 0;
        statusLog = "";
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }
}
