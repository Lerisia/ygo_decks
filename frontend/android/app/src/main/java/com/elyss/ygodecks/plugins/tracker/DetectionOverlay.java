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

    private static final long DISPLAY_DURATION_MS = 2500;
    private final WindowManager windowManager;
    private final Context context;
    private final Handler handler;
    private TextView currentView;

    public DetectionOverlay(Context context) {
        this.context = context;
        this.windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        this.handler = new Handler(Looper.getMainLooper());
    }

    public void show(String message) {
        handler.post(() -> {
            dismiss();

            TextView tv = new TextView(context);
            tv.setText(message);
            tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            tv.setTextColor(0xFFFFFFFF);
            tv.setBackgroundColor(0xCC000000);
            tv.setPadding(24, 12, 24, 12);

            WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                            : WindowManager.LayoutParams.TYPE_PHONE,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                    PixelFormat.TRANSLUCENT
            );
            params.gravity = Gravity.TOP | Gravity.END;
            params.x = 24;
            params.y = 80;

            try {
                windowManager.addView(tv, params);
                currentView = tv;
            } catch (Exception e) {
                // Overlay permission not granted
                return;
            }

            handler.postDelayed(this::dismiss, DISPLAY_DURATION_MS);
        });
    }

    public void dismiss() {
        if (currentView != null) {
            try {
                windowManager.removeView(currentView);
            } catch (Exception ignored) {}
            currentView = null;
        }
    }
}
