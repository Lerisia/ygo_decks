package com.elyss.ygodecks.plugins.tracker;

import android.app.Service;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

public class FloatingWidgetService extends Service {

    private WindowManager windowManager;
    private View floatingBubble;
    private View expandedPanel;
    private boolean isExpanded = false;

    private TextView statusText;
    private TextView coinText;
    private TextView fsText;
    private TextView resultText;
    private TextView deckText;

    private WindowManager.LayoutParams bubbleParams;

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        createBubble();
    }

    private int layoutType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private void createBubble() {
        // Collapsed bubble
        TextView bubble = new TextView(this);
        bubble.setText("YGO");
        bubble.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        bubble.setTextColor(0xFFFFFFFF);
        bubble.setBackgroundColor(0xDD1E3A5F);
        bubble.setPadding(20, 12, 20, 12);
        bubble.setGravity(Gravity.CENTER);

        bubbleParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                layoutType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
        );
        bubbleParams.gravity = Gravity.TOP | Gravity.START;
        bubbleParams.x = 0;
        bubbleParams.y = 200;

        // Drag support
        bubble.setOnTouchListener(new View.OnTouchListener() {
            private int initialX, initialY;
            private float initialTouchX, initialTouchY;
            private boolean moved = false;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        initialX = bubbleParams.x;
                        initialY = bubbleParams.y;
                        initialTouchX = event.getRawX();
                        initialTouchY = event.getRawY();
                        moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = (int) (event.getRawX() - initialTouchX);
                        int dy = (int) (event.getRawY() - initialTouchY);
                        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) moved = true;
                        bubbleParams.x = initialX + dx;
                        bubbleParams.y = initialY + dy;
                        windowManager.updateViewLayout(floatingBubble, bubbleParams);
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (!moved) toggleExpand();
                        return true;
                }
                return false;
            }
        });

        floatingBubble = bubble;
        windowManager.addView(floatingBubble, bubbleParams);
    }

    private void toggleExpand() {
        if (isExpanded) {
            collapse();
        } else {
            expand();
        }
    }

    private void expand() {
        if (expandedPanel != null) return;

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(0xEE1E1E1E);
        panel.setPadding(24, 16, 24, 16);

        statusText = addText(panel, "트래킹 중", 14, 0xFF4ADE80);

        addText(panel, "", 4, 0x00000000); // spacer

        coinText = addText(panel, "코인: -", 12, 0xFFD1D5DB);
        fsText = addText(panel, "선후공: -", 12, 0xFFD1D5DB);
        resultText = addText(panel, "결과: -", 12, 0xFFD1D5DB);

        addText(panel, "", 4, 0x00000000); // spacer

        deckText = addText(panel, "덱: -", 12, 0xFF93C5FD);

        // Close button
        TextView closeBtn = addText(panel, "닫기", 12, 0xFF9CA3AF);
        closeBtn.setPadding(0, 12, 0, 0);
        closeBtn.setOnClickListener(v -> collapse());

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                layoutType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = bubbleParams.x;
        params.y = bubbleParams.y + 60;

        expandedPanel = panel;
        windowManager.addView(expandedPanel, params);
        isExpanded = true;

        updatePanel();
    }

    private void collapse() {
        if (expandedPanel != null) {
            try { windowManager.removeView(expandedPanel); } catch (Exception ignored) {}
            expandedPanel = null;
        }
        isExpanded = false;
    }

    public void updatePanel() {
        if (!isExpanded) return;

        String coin = ScreenCaptureService.lastCoinToss;
        String fs = ScreenCaptureService.lastFirstSecond;
        String result = ScreenCaptureService.lastDuelResult;

        if (coinText != null) {
            coinText.setText("코인: " + (coin == null ? "-" : ("win".equals(coin) ? "앞면" : "뒷면")));
            coinText.setTextColor(coin == null ? 0xFF9CA3AF : ("win".equals(coin) ? 0xFF3B82F6 : 0xFFEF4444));
        }
        if (fsText != null) {
            fsText.setText("선후공: " + (fs == null ? "-" : ("first".equals(fs) ? "선공" : "후공")));
            fsText.setTextColor(fs == null ? 0xFF9CA3AF : ("first".equals(fs) ? 0xFF3B82F6 : 0xFFF97316));
        }
        if (resultText != null) {
            resultText.setText("결과: " + (result == null ? "-" : ("win".equals(result) ? "승리" : "패배")));
            resultText.setTextColor(result == null ? 0xFF9CA3AF : ("win".equals(result) ? 0xFF3B82F6 : 0xFFEF4444));
        }
    }

    public void setDeckName(String name) {
        if (deckText != null) {
            deckText.setText("덱: " + (name != null ? name : "-"));
        }
    }

    private TextView addText(LinearLayout parent, String text, int sizeSp, int color) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
        tv.setTextColor(color);
        parent.addView(tv);
        return tv;
    }

    @Override
    public void onDestroy() {
        collapse();
        if (floatingBubble != null) {
            try { windowManager.removeView(floatingBubble); } catch (Exception ignored) {}
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
