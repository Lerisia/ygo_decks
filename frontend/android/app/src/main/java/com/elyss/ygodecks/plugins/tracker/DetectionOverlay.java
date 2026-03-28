package com.elyss.ygodecks.plugins.tracker;

import android.content.Context;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.TextView;

public class DetectionOverlay {

    private final WindowManager windowManager;
    private final Context context;
    private final Handler handler;
    private TextView persistentView;
    private TextView flashView;

    public DetectionOverlay(Context context) {
        this.context = context;
        this.windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        this.handler = new Handler(Looper.getMainLooper());
    }

    private int layoutType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    /**
     * Show persistent small text in top-left corner.
     * Updates every capture with OCR status.
     */
    public void updateStatus(String text) {
        handler.post(() -> {
            if (persistentView == null) {
                persistentView = new TextView(context);
                persistentView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
                persistentView.setTextColor(0xAAFFFFFF);
                persistentView.setBackgroundColor(0x66000000);
                persistentView.setPadding(12, 6, 12, 6);
                persistentView.setMaxWidth(600);
                persistentView.setMaxLines(2);

                WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        layoutType(),
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                                | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                        PixelFormat.TRANSLUCENT
                );
                params.gravity = Gravity.TOP | Gravity.START;
                params.x = 8;
                params.y = 40;

                try {
                    windowManager.addView(persistentView, params);
                } catch (Exception e) {
                    persistentView = null;
                    return;
                }
            }
            persistentView.setText(text);
        });
    }

    /**
     * Flash a detection result briefly in top-right corner.
     */
    public void show(String message) {
        handler.post(() -> {
            dismissFlash();

            flashView = new TextView(context);
            flashView.setText(message);
            flashView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            flashView.setTextColor(0xFFFFFFFF);
            flashView.setBackgroundColor(0xCC000000);
            flashView.setPadding(24, 12, 24, 12);

            WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    layoutType(),
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                    PixelFormat.TRANSLUCENT
            );
            params.gravity = Gravity.TOP | Gravity.END;
            params.x = 24;
            params.y = 80;

            try {
                windowManager.addView(flashView, params);
            } catch (Exception e) {
                return;
            }

            handler.postDelayed(this::dismissFlash, 2500);
        });
    }

    private void dismissFlash() {
        if (flashView != null) {
            try { windowManager.removeView(flashView); } catch (Exception ignored) {}
            flashView = null;
        }
    }

    public void dismiss() {
        dismissFlash();
        if (persistentView != null) {
            try { windowManager.removeView(persistentView); } catch (Exception ignored) {}
            persistentView = null;
        }
    }
}
