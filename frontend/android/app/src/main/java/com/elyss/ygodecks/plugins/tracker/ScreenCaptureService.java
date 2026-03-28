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
import android.os.IBinder;
import android.os.Looper;
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
    private static final long CAPTURE_INTERVAL_MS = 3000;

    public static volatile String lastCoinToss = null;
    public static volatile String lastDuelResult = null;
    public static volatile long lastDetectionTime = 0;

    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private Handler handler;
    private Runnable captureRunnable;
    private boolean isCapturing = false;

    private int screenWidth;
    private int screenHeight;
    private int screenDensity;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        handler = new Handler(Looper.getMainLooper());

        DisplayMetrics metrics = new DisplayMetrics();
        WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        wm.getDefaultDisplay().getRealMetrics(metrics);

        screenWidth = metrics.widthPixels / 2;
        screenHeight = metrics.heightPixels / 2;
        screenDensity = metrics.densityDpi / 2;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("YGODecks 트래커")
                .setContentText("듀얼을 감지하고 있습니다...")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setOngoing(true)
                .build();

        startForeground(NOTIFICATION_ID, notification);

        int resultCode = intent.getIntExtra("resultCode", -1);
        Intent data = intent.getParcelableExtra("data");

        if (data == null || resultCode == -1) {
            stopSelf();
            return START_NOT_STICKY;
        }

        MediaProjectionManager mgr = (MediaProjectionManager)
                getSystemService(MEDIA_PROJECTION_SERVICE);
        mediaProjection = mgr.getMediaProjection(resultCode, data);

        if (mediaProjection == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        startCapture();
        return START_STICKY;
    }

    private void startCapture() {
        imageReader = ImageReader.newInstance(screenWidth, screenHeight, PixelFormat.RGBA_8888, 2);

        virtualDisplay = mediaProjection.createVirtualDisplay(
                "DuelTracker",
                screenWidth, screenHeight, screenDensity,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null, handler
        );

        isCapturing = true;

        captureRunnable = new Runnable() {
            @Override
            public void run() {
                if (!isCapturing) return;
                captureAndAnalyze();
                handler.postDelayed(this, CAPTURE_INTERVAL_MS);
            }
        };
        handler.postDelayed(captureRunnable, CAPTURE_INTERVAL_MS);

        Log.d(TAG, "Screen capture started");
    }

    private void captureAndAnalyze() {
        if (imageReader == null) return;

        Image image = imageReader.acquireLatestImage();
        if (image == null) return;

        try {
            Image.Plane[] planes = image.getPlanes();
            ByteBuffer buffer = planes[0].getBuffer();
            int pixelStride = planes[0].getPixelStride();
            int rowStride = planes[0].getRowStride();
            int rowPadding = rowStride - pixelStride * screenWidth;

            Bitmap bitmap = Bitmap.createBitmap(
                    screenWidth + rowPadding / pixelStride,
                    screenHeight,
                    Bitmap.Config.ARGB_8888
            );
            bitmap.copyPixelsFromBuffer(buffer);

            Bitmap cropped = Bitmap.createBitmap(bitmap, 0, 0, screenWidth, screenHeight);

            ScreenAnalyzer.AnalysisResult result = ScreenAnalyzer.analyze(cropped);

            if (result != null) {
                if (result.type == ScreenAnalyzer.DetectionType.COIN_TOSS) {
                    lastCoinToss = result.value;
                    lastDetectionTime = System.currentTimeMillis();
                    Log.d(TAG, "Coin toss detected: " + result.value);
                } else if (result.type == ScreenAnalyzer.DetectionType.DUEL_RESULT) {
                    lastDuelResult = result.value;
                    lastDetectionTime = System.currentTimeMillis();
                    Log.d(TAG, "Duel result detected: " + result.value);
                }
            }

            if (cropped != bitmap) cropped.recycle();
            bitmap.recycle();
        } catch (Exception e) {
            Log.e(TAG, "Capture error", e);
        } finally {
            image.close();
        }
    }

    private void stopCapture() {
        isCapturing = false;
        if (handler != null && captureRunnable != null) {
            handler.removeCallbacks(captureRunnable);
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
        Log.d(TAG, "Screen capture stopped");
    }

    @Override
    public void onDestroy() {
        stopCapture();
        lastCoinToss = null;
        lastDuelResult = null;
        lastDetectionTime = 0;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
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
}
