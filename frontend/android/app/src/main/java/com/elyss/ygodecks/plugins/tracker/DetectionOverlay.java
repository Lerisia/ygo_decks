package com.elyss.ygodecks.plugins.tracker;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

public class DetectionOverlay {

    private final WindowManager windowManager;
    private final Context context;
    private final Handler handler;

    // Views
    private LinearLayout rootLayout;
    private TextView statusView;        // Collapsed: status pill
    private LinearLayout resultLayout;  // Expanded: result + edit UI
    private TextView countdownView;

    // Result display row
    private TextView coinLabel, fsLabel, resultLabel;

    // Edit mode views
    private LinearLayout editLayout;
    private TextView coinWinBtn, coinLoseBtn;
    private TextView fsFirstBtn, fsSecondBtn;
    private TextView resultWinBtn, resultLoseBtn;
    private TextView saveBtn, dismissBtn;

    private boolean isExpanded = false;
    private boolean isEditMode = false;

    // Countdown
    private int countdownSeconds = 0;
    private Runnable countdownRunnable;

    // Current values (native-side, synced to ScreenCaptureService)
    private String currentCoin = null;
    private String currentFS = null;
    private String currentResult = null;

    private static final int BG_COLOR = 0xE6222222;
    private static final int ACCENT_BLUE = 0xFF3B82F6;
    private static final int ACCENT_RED = 0xFFEF4444;
    private static final int ACCENT_GREEN = 0xFF22C55E;
    private static final int TEXT_WHITE = 0xFFFFFFFF;
    private static final int TEXT_DIM = 0xFF999999;
    private static final int BTN_INACTIVE = 0xFF444444;

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

    private int dp(int value) {
        return (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, context.getResources().getDisplayMetrics());
    }

    private int sp(int value) {
        return (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_SP, value, context.getResources().getDisplayMetrics());
    }

    private GradientDrawable roundedBg(int color, int radiusDp) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color);
        bg.setCornerRadius(dp(radiusDp));
        return bg;
    }

    private void ensureRoot() {
        if (rootLayout != null) return;

        rootLayout = new LinearLayout(context);
        rootLayout.setOrientation(LinearLayout.VERTICAL);
        rootLayout.setBackground(roundedBg(BG_COLOR, 12));
        rootLayout.setPadding(dp(14), dp(8), dp(14), dp(8));
        rootLayout.setGravity(Gravity.CENTER_HORIZONTAL);

        // --- Status pill (collapsed) ---
        statusView = new TextView(context);
        statusView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        statusView.setTextColor(TEXT_DIM);
        statusView.setGravity(Gravity.CENTER);
        statusView.setText("감지 중...");
        rootLayout.addView(statusView);

        // --- Result layout (expanded) ---
        resultLayout = new LinearLayout(context);
        resultLayout.setOrientation(LinearLayout.VERTICAL);
        resultLayout.setGravity(Gravity.CENTER_HORIZONTAL);
        resultLayout.setVisibility(View.GONE);

        // Result summary row
        LinearLayout summaryRow = new LinearLayout(context);
        summaryRow.setOrientation(LinearLayout.HORIZONTAL);
        summaryRow.setGravity(Gravity.CENTER);

        coinLabel = makeLabel("코인", 13);
        fsLabel = makeLabel("선후공", 13);
        resultLabel = makeLabel("결과", 15);
        resultLabel.setTypeface(Typeface.DEFAULT_BOLD);

        summaryRow.addView(coinLabel);
        summaryRow.addView(makeSeparator());
        summaryRow.addView(fsLabel);
        summaryRow.addView(makeSeparator());
        summaryRow.addView(resultLabel);
        summaryRow.addView(makeSpacer(8));

        countdownView = new TextView(context);
        countdownView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        countdownView.setTextColor(TEXT_DIM);
        summaryRow.addView(countdownView);

        // Edit button (tap summary to edit)
        TextView editBtn = new TextView(context);
        editBtn.setText("  수정");
        editBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        editBtn.setTextColor(ACCENT_BLUE);
        editBtn.setOnClickListener(v -> toggleEditMode());
        summaryRow.addView(editBtn);

        resultLayout.addView(summaryRow);

        // --- Edit layout ---
        editLayout = new LinearLayout(context);
        editLayout.setOrientation(LinearLayout.VERTICAL);
        editLayout.setVisibility(View.GONE);
        editLayout.setPadding(0, dp(6), 0, 0);

        // Coin row
        LinearLayout coinRow = new LinearLayout(context);
        coinRow.setOrientation(LinearLayout.HORIZONTAL);
        coinRow.setGravity(Gravity.CENTER);
        coinRow.addView(makeRowLabel("코인"));
        coinWinBtn = makeToggleBtn("앞 (승)");
        coinLoseBtn = makeToggleBtn("뒤 (패)");
        coinWinBtn.setOnClickListener(v -> { currentCoin = "win"; syncOverlayValues(); updateEditButtons(); });
        coinLoseBtn.setOnClickListener(v -> { currentCoin = "lose"; syncOverlayValues(); updateEditButtons(); });
        coinRow.addView(coinWinBtn);
        coinRow.addView(makeSpacer(4));
        coinRow.addView(coinLoseBtn);
        editLayout.addView(coinRow);

        editLayout.addView(makeSpacer(4));

        // First/Second row
        LinearLayout fsRow = new LinearLayout(context);
        fsRow.setOrientation(LinearLayout.HORIZONTAL);
        fsRow.setGravity(Gravity.CENTER);
        fsRow.addView(makeRowLabel("순서"));
        fsFirstBtn = makeToggleBtn("선공");
        fsSecondBtn = makeToggleBtn("후공");
        fsFirstBtn.setOnClickListener(v -> { currentFS = "first"; syncOverlayValues(); updateEditButtons(); });
        fsSecondBtn.setOnClickListener(v -> { currentFS = "second"; syncOverlayValues(); updateEditButtons(); });
        fsRow.addView(fsFirstBtn);
        fsRow.addView(makeSpacer(4));
        fsRow.addView(fsSecondBtn);
        editLayout.addView(fsRow);

        editLayout.addView(makeSpacer(4));

        // Result row
        LinearLayout resRow = new LinearLayout(context);
        resRow.setOrientation(LinearLayout.HORIZONTAL);
        resRow.setGravity(Gravity.CENTER);
        resRow.addView(makeRowLabel("결과"));
        resultWinBtn = makeToggleBtn("승리");
        resultLoseBtn = makeToggleBtn("패배");
        resultWinBtn.setOnClickListener(v -> { currentResult = "win"; syncOverlayValues(); updateEditButtons(); });
        resultLoseBtn.setOnClickListener(v -> { currentResult = "lose"; syncOverlayValues(); updateEditButtons(); });
        resRow.addView(resultWinBtn);
        resRow.addView(makeSpacer(4));
        resRow.addView(resultLoseBtn);
        editLayout.addView(resRow);

        editLayout.addView(makeSpacer(6));

        // Action buttons
        LinearLayout actionRow = new LinearLayout(context);
        actionRow.setOrientation(LinearLayout.HORIZONTAL);
        actionRow.setGravity(Gravity.CENTER);

        saveBtn = makeActionBtn("저장", ACCENT_GREEN);
        saveBtn.setOnClickListener(v -> {
            syncOverlayValues();
            ScreenCaptureService.overlayAction = "save";
            collapseToStatus("저장 완료");
        });

        dismissBtn = makeActionBtn("무시", 0xFF666666);
        dismissBtn.setOnClickListener(v -> {
            ScreenCaptureService.overlayAction = "dismiss";
            collapseToStatus("무시됨");
        });

        actionRow.addView(saveBtn);
        actionRow.addView(makeSpacer(8));
        actionRow.addView(dismissBtn);
        editLayout.addView(actionRow);

        resultLayout.addView(editLayout);
        rootLayout.addView(resultLayout);

        // Add to window
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                layoutType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.y = dp(12);

        try {
            windowManager.addView(rootLayout, params);
        } catch (Exception e) {
            rootLayout = null;
        }
    }

    // === Public API ===

    public void updateStatus(String text) {
        handler.post(() -> {
            ensureRoot();
            if (rootLayout == null) return;
            if (!isExpanded) {
                statusView.setText(text);
            }
        });
    }

    public void showResult(String coin, String fs, String result) {
        handler.post(() -> {
            ensureRoot();
            if (rootLayout == null) return;

            currentCoin = coin;
            currentFS = fs;
            currentResult = result;
            syncOverlayValues();

            // Update summary labels
            updateSummaryLabels();

            // Switch to expanded
            statusView.setVisibility(View.GONE);
            resultLayout.setVisibility(View.VISIBLE);
            editLayout.setVisibility(View.GONE);
            isExpanded = true;
            isEditMode = false;

            // Start countdown
            startCountdown(7);
        });
    }

    public void show(String message) {
        // Legacy flash — redirect to status
        updateStatus(message);
    }

    private void collapseToStatus(String msg) {
        handler.post(() -> {
            stopCountdown();
            isExpanded = false;
            isEditMode = false;
            statusView.setText(msg);
            statusView.setVisibility(View.VISIBLE);
            resultLayout.setVisibility(View.GONE);
            editLayout.setVisibility(View.GONE);
        });
    }

    private void toggleEditMode() {
        if (!isEditMode) {
            // Enter edit mode — pause countdown
            stopCountdown();
            countdownView.setText("수정 중");
            editLayout.setVisibility(View.VISIBLE);
            updateEditButtons();
            isEditMode = true;
        } else {
            // Exit edit mode — resume countdown
            editLayout.setVisibility(View.GONE);
            isEditMode = false;
            updateSummaryLabels();
            startCountdown(5);
        }
    }

    // === Countdown ===

    private void startCountdown(int seconds) {
        stopCountdown();
        countdownSeconds = seconds;
        updateCountdownText();
        countdownRunnable = new Runnable() {
            @Override
            public void run() {
                countdownSeconds--;
                if (countdownSeconds <= 0) {
                    // Auto-save
                    syncOverlayValues();
                    ScreenCaptureService.overlayAction = "save";
                    collapseToStatus("자동 저장됨");
                } else {
                    updateCountdownText();
                    handler.postDelayed(this, 1000);
                }
            }
        };
        handler.postDelayed(countdownRunnable, 1000);
    }

    private void stopCountdown() {
        if (countdownRunnable != null) {
            handler.removeCallbacks(countdownRunnable);
            countdownRunnable = null;
        }
    }

    private void updateCountdownText() {
        countdownView.setText(countdownSeconds + "초");
    }

    // === Sync values to service statics ===

    private void syncOverlayValues() {
        ScreenCaptureService.overlayCoin = currentCoin;
        ScreenCaptureService.overlayFS = currentFS;
        ScreenCaptureService.overlayResult = currentResult;
    }

    // === UI update helpers ===

    private void updateSummaryLabels() {
        coinLabel.setText("win".equals(currentCoin) ? "앞" : "뒤");
        coinLabel.setTextColor("win".equals(currentCoin) ? 0xFFFFD700 : TEXT_WHITE);

        fsLabel.setText("first".equals(currentFS) ? "선공" : "후공");
        fsLabel.setTextColor(ACCENT_BLUE);

        String rText = "win".equals(currentResult) ? "승리" : "패배";
        resultLabel.setText(rText);
        resultLabel.setTextColor("win".equals(currentResult) ? ACCENT_GREEN : ACCENT_RED);
    }

    private void updateEditButtons() {
        setToggleState(coinWinBtn, "win".equals(currentCoin));
        setToggleState(coinLoseBtn, "lose".equals(currentCoin));
        setToggleState(fsFirstBtn, "first".equals(currentFS));
        setToggleState(fsSecondBtn, "second".equals(currentFS));
        setToggleState(resultWinBtn, "win".equals(currentResult));
        setToggleState(resultLoseBtn, "lose".equals(currentResult));
    }

    private void setToggleState(TextView btn, boolean active) {
        btn.setBackground(roundedBg(active ? ACCENT_BLUE : BTN_INACTIVE, 6));
        btn.setTextColor(active ? TEXT_WHITE : TEXT_DIM);
    }

    // === View factory helpers ===

    private TextView makeLabel(String text, int textSizeSp) {
        TextView tv = new TextView(context);
        tv.setText(text);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, textSizeSp);
        tv.setTextColor(TEXT_WHITE);
        tv.setPadding(dp(6), 0, dp(6), 0);
        return tv;
    }

    private View makeSeparator() {
        TextView tv = new TextView(context);
        tv.setText("|");
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        tv.setTextColor(0xFF555555);
        tv.setPadding(dp(2), 0, dp(2), 0);
        return tv;
    }

    private View makeSpacer(int widthDp) {
        View v = new View(context);
        v.setLayoutParams(new LinearLayout.LayoutParams(dp(widthDp), 1));
        return v;
    }

    private TextView makeRowLabel(String text) {
        TextView tv = new TextView(context);
        tv.setText(text);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        tv.setTextColor(TEXT_DIM);
        tv.setWidth(dp(40));
        return tv;
    }

    private TextView makeToggleBtn(String text) {
        TextView tv = new TextView(context);
        tv.setText(text);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        tv.setTextColor(TEXT_DIM);
        tv.setBackground(roundedBg(BTN_INACTIVE, 6));
        tv.setPadding(dp(12), dp(6), dp(12), dp(6));
        tv.setGravity(Gravity.CENTER);
        return tv;
    }

    private TextView makeActionBtn(String text, int bgColor) {
        TextView tv = new TextView(context);
        tv.setText(text);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        tv.setTextColor(TEXT_WHITE);
        tv.setTypeface(Typeface.DEFAULT_BOLD);
        tv.setBackground(roundedBg(bgColor, 8));
        tv.setPadding(dp(24), dp(8), dp(24), dp(8));
        tv.setGravity(Gravity.CENTER);
        return tv;
    }

    // === Cleanup ===

    public void dismiss() {
        stopCountdown();
        if (rootLayout != null) {
            try { windowManager.removeView(rootLayout); } catch (Exception ignored) {}
            rootLayout = null;
        }
    }
}
