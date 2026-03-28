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
    public static volatile String statusLog = "초기화 중...";

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

    private int captureWidth;
    private int captureHeight;
    private int captureDensity;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "Service onCreate");
        createNotificationChannel();
        mainHandler = new Handler(getMainLooper());

        // Background thread for capture + OCR
        captureThread = new HandlerThread("DuelTrackerCapture");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());

        overlay = new DetectionOverlay(this);

        // Use half resolution to save memory
        try {
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            DisplayMetrics metrics = new DisplayMetrics();
            wm.getDefaultDisplay().getRealMetrics(metrics);
            captureWidth = metrics.widthPixels / 2;
            captureHeight = metrics.heightPixels / 2;
            captureDensity = metrics.densityDpi / 2;
        } catch (Exception e) {
            Log.e(TAG, "Display metrics failed", e);
            captureWidth = 540;
            captureHeight = 1200;
            captureDensity = 210;
        }

        statusLog = "화면: " + captureWidth + "x" + captureHeight;
        Log.d(TAG, statusLog);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "Service onStartCommand");

        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        // Start foreground FIRST before anything else
        try {
            Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setContentTitle("YGODecks 트래커")
                    .setContentText("듀얼을 감지하고 있습니다...")
                    .setSmallIcon(android.R.drawable.ic_media_play)
                    .setOngoing(true)
                    .build();

            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFICATION_ID, notification,
                        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            statusLog = "포그라운드 서비스 시작됨";
            Log.d(TAG, statusLog);
        } catch (Exception e) {
            statusLog = "포그라운드 실패: " + e.getMessage();
            Log.e(TAG, statusLog, e);
            stopSelf();
            return START_NOT_STICKY;
        }

        // Get MediaProjection
        int resultCode = intent.getIntExtra("resultCode", -1);
        Intent data = intent.getParcelableExtra("data");

        if (data == null || resultCode == -1) {
            statusLog = "MediaProjection 데이터 없음";
            Log.e(TAG, statusLog);
            stopSelf();
            return START_NOT_STICKY;
        }

        try {
            MediaProjectionManager mgr = (MediaProjectionManager)
                    getSystemService(MEDIA_PROJECTION_SERVICE);
            mediaProjection = mgr.getMediaProjection(resultCode, data);

            if (mediaProjection == null) {
                statusLog = "MediaProjection null";
                Log.e(TAG, statusLog);
                stopSelf();
                return START_NOT_STICKY;
            }

            statusLog = "캡처 시작 중...";
            Log.d(TAG, statusLog);
            startCapture();
        } catch (Exception e) {
            statusLog = "캡처 실패: " + e.getMessage();
            Log.e(TAG, statusLog, e);
            stopSelf();
            return START_NOT_STICKY;
        }

        return START_STICKY;
    }

    private void startCapture() {
        try {
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

            statusLog = "캡처 동작 중";
            Log.d(TAG, statusLog);
            updateNotification("감지 시작됨");
        } catch (Exception e) {
            statusLog = "캡처 시작 실패: " + e.getMessage();
            Log.e(TAG, statusLog, e);
            updateNotification(statusLog);
        }
    }

    private void updateNotification(String text) {
        try {
            Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setContentTitle("YGODecks 트래커")
                    .setContentText(text)
                    .setSmallIcon(android.R.drawable.ic_media_play)
                    .setOngoing(true)
                    .build();
            NotificationManager mgr = getSystemService(NotificationManager.class);
            mgr.notify(NOTIFICATION_ID, notification);
        } catch (Exception e) {
            Log.e(TAG, "updateNotification failed", e);
        }
    }

    private void captureAndAnalyze() {
        if (imageReader == null) return;

        Image image = null;
        try {
            image = imageReader.acquireLatestImage();
        } catch (Exception e) {
            Log.e(TAG, "acquireLatestImage failed", e);
            return;
        }

        if (image == null) {
            statusLog = "스캔 " + captureCount + "회 (이미지 없음)";
            return;
        }

        captureCount++;
        statusLog = "스캔 " + captureCount + "회";
        if (captureCount % 3 == 0) {
            updateNotification("감지 중... (" + captureCount + "회)");
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
                final String overlayMsg;
                final String notifMsg;

                switch (result.type) {
                    case COIN_TOSS:
                        lastCoinToss = result.value;
                        overlayMsg = "코인토스: " + ("win".equals(result.value) ? "앞면" : "뒷면");
                        notifMsg = overlayMsg;
                        break;
                    case FIRST_SECOND:
                        lastFirstSecond = result.value;
                        overlayMsg = "first".equals(result.value) ? "선공" : "후공";
                        notifMsg = "선후공: " + overlayMsg;
                        break;
                    case DUEL_RESULT:
                        lastDuelResult = result.value;
                        overlayMsg = ("win".equals(result.value) ? "승리" : "패배") + " - 자동 기록됨";
                        notifMsg = "결과: " + overlayMsg;
                        break;
                    default:
                        overlayMsg = null;
                        notifMsg = null;
                }

                if (overlayMsg != null) {
                    statusLog = notifMsg;
                    mainHandler.post(() -> overlay.show(overlayMsg));
                    updateNotification(notifMsg);
                }
            }

            if (cropped != bitmap) cropped.recycle();
            bitmap.recycle();
        } catch (Exception e) {
            statusLog = "분석 오류: " + e.getMessage();
            Log.e(TAG, "Capture analysis error", e);
        } finally {
            image.close();
        }
    }

    private void stopCapture() {
        isCapturing = false;
        if (captureHandler != null && captureRunnable != null) {
            captureHandler.removeCallbacks(captureRunnable);
        }
        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
        if (imageReader != null) {
            imageReader.close();
            imageReader = null;
        }
        if (mediaProjection != null) {
            mediaProjection.stop();
            mediaProjection = null;
        }
        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
        }
    }

    @Override
    public void onDestroy() {
        stopCapture();
        if (overlay != null) overlay.dismiss();
        lastCoinToss = null;
        lastFirstSecond = null;
        lastDuelResult = null;
        lastDetectionTime = 0;
        statusLog = "중지됨";
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "듀얼 트래커",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("듀얼 자동 감지 서비스");
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
    }
}
