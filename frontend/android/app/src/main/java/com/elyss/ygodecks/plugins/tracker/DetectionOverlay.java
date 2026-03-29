package com.elyss.ygodecks.plugins.tracker;

import android.content.Context;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

public class DetectionOverlay {

    private final WindowManager windowManager;
    private final Context context;
    private final Handler handler;

    private LinearLayout rootLayout;
    private TextView statusView;
    private LinearLayout resultLayout;
    private TextView countdownView;

    private TextView coinLabel, fsLabel, resultLabel;

    private LinearLayout editLayout;
    private TextView coinWinBtn, coinLoseBtn;
    private TextView fsFirstBtn, fsSecondBtn;
    private TextView resultWinBtn, resultLoseBtn;
    private TextView saveBtn, dismissBtn;

    // Deck search
    private LinearLayout searchLayout;
    private EditText searchInput;
    private LinearLayout searchResults;
    private int selectedOpponentDeckId = -1;
    private TextView selectedDeckLabel;

    private boolean isExpanded = false;
    private boolean isEditMode = false;

    private int countdownSeconds = 0;
    private Runnable countdownRunnable;

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

    // Korean chosung table
    private static final char[] CHOSUNG = {
        'ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ',
        'ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'
    };

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

        // --- Status pill ---
        statusView = new TextView(context);
        statusView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        statusView.setTextColor(TEXT_DIM);
        statusView.setGravity(Gravity.CENTER);
        statusView.setText("대기 중");
        rootLayout.addView(statusView);

        // --- Result layout ---
        resultLayout = new LinearLayout(context);
        resultLayout.setOrientation(LinearLayout.VERTICAL);
        resultLayout.setGravity(Gravity.CENTER_HORIZONTAL);
        resultLayout.setVisibility(View.GONE);

        // Summary row
        LinearLayout summaryRow = new LinearLayout(context);
        summaryRow.setOrientation(LinearLayout.HORIZONTAL);
        summaryRow.setGravity(Gravity.CENTER);

        coinLabel = makeLabel("", 13);
        fsLabel = makeLabel("", 13);
        resultLabel = makeLabel("", 15);
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

        TextView editBtn = new TextView(context);
        editBtn.setText("  수정");
        editBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        editBtn.setTextColor(ACCENT_BLUE);
        editBtn.setOnClickListener(v -> toggleEditMode());
        summaryRow.addView(editBtn);

        resultLayout.addView(summaryRow);

        // --- Opponent deck display (shown in summary when selected) ---
        selectedDeckLabel = new TextView(context);
        selectedDeckLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        selectedDeckLabel.setTextColor(0xFFAABBCC);
        selectedDeckLabel.setGravity(Gravity.CENTER);
        selectedDeckLabel.setVisibility(View.GONE);
        resultLayout.addView(selectedDeckLabel);

        // --- Edit layout ---
        editLayout = new LinearLayout(context);
        editLayout.setOrientation(LinearLayout.VERTICAL);
        editLayout.setVisibility(View.GONE);
        editLayout.setPadding(0, dp(6), 0, 0);

        // Coin row
        LinearLayout coinRow = makeEditRow("코인");
        coinWinBtn = makeToggleBtn("앞 (승)");
        coinLoseBtn = makeToggleBtn("뒤 (패)");
        coinWinBtn.setOnClickListener(v -> { currentCoin = "win"; syncOverlayValues(); updateEditButtons(); });
        coinLoseBtn.setOnClickListener(v -> { currentCoin = "lose"; syncOverlayValues(); updateEditButtons(); });
        coinRow.addView(coinWinBtn);
        coinRow.addView(makeSpacer(4));
        coinRow.addView(coinLoseBtn);
        editLayout.addView(coinRow);
        editLayout.addView(makeSpacer(4));

        // FS row
        LinearLayout fsRow = makeEditRow("순서");
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
        LinearLayout resRow = makeEditRow("결과");
        resultWinBtn = makeToggleBtn("승리");
        resultLoseBtn = makeToggleBtn("패배");
        resultWinBtn.setOnClickListener(v -> { currentResult = "win"; syncOverlayValues(); updateEditButtons(); });
        resultLoseBtn.setOnClickListener(v -> { currentResult = "lose"; syncOverlayValues(); updateEditButtons(); });
        resRow.addView(resultWinBtn);
        resRow.addView(makeSpacer(4));
        resRow.addView(resultLoseBtn);
        editLayout.addView(resRow);
        editLayout.addView(makeSpacer(6));

        // --- Deck search ---
        searchLayout = new LinearLayout(context);
        searchLayout.setOrientation(LinearLayout.VERTICAL);

        searchInput = new EditText(context);
        searchInput.setHint("상대 덱 검색 (초성 가능)");
        searchInput.setHintTextColor(0xFF666666);
        searchInput.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        searchInput.setTextColor(TEXT_WHITE);
        searchInput.setBackground(roundedBg(0xFF333333, 6));
        searchInput.setPadding(dp(10), dp(6), dp(10), dp(6));
        searchInput.setSingleLine(true);
        searchInput.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
            @Override public void onTextChanged(CharSequence s, int st, int b, int c) {}
            @Override public void afterTextChanged(Editable s) {
                onSearchChanged(s.toString());
            }
        });
        searchLayout.addView(searchInput);

        searchResults = new LinearLayout(context);
        searchResults.setOrientation(LinearLayout.VERTICAL);
        searchLayout.addView(searchResults);

        editLayout.addView(searchLayout);
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

        // Window params - FLAG_NOT_FOCUSABLE so keyboard works only when we request it
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                layoutType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.y = 0;

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
            selectedOpponentDeckId = -1;
            syncOverlayValues();

            updateSummaryLabels();
            selectedDeckLabel.setVisibility(View.GONE);

            statusView.setVisibility(View.GONE);
            resultLayout.setVisibility(View.VISIBLE);
            editLayout.setVisibility(View.GONE);
            isExpanded = true;
            isEditMode = false;

            startCountdown(7);
        });
    }

    public void show(String message) {
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
            hideKeyboard();
        });
    }

    private void toggleEditMode() {
        if (!isEditMode) {
            stopCountdown();
            countdownView.setText("수정 중");
            editLayout.setVisibility(View.VISIBLE);
            updateEditButtons();
            searchInput.setText("");
            searchResults.removeAllViews();
            isEditMode = true;
            // Allow keyboard input
            enableFocusable();
        } else {
            editLayout.setVisibility(View.GONE);
            isEditMode = false;
            updateSummaryLabels();
            hideKeyboard();
            disableFocusable();
            startCountdown(5);
        }
    }

    // === Keyboard / Focus management ===

    private void enableFocusable() {
        if (rootLayout == null) return;
        WindowManager.LayoutParams params = (WindowManager.LayoutParams) rootLayout.getLayoutParams();
        params.flags &= ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        try { windowManager.updateViewLayout(rootLayout, params); } catch (Exception ignored) {}
    }

    private void disableFocusable() {
        if (rootLayout == null) return;
        WindowManager.LayoutParams params = (WindowManager.LayoutParams) rootLayout.getLayoutParams();
        params.flags |= WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        try { windowManager.updateViewLayout(rootLayout, params); } catch (Exception ignored) {}
    }

    private void hideKeyboard() {
        if (searchInput == null) return;
        InputMethodManager imm = (InputMethodManager) context.getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(searchInput.getWindowToken(), 0);
    }

    // === Deck search ===

    private void onSearchChanged(String query) {
        searchResults.removeAllViews();
        if (query.isEmpty()) return;

        int[] ids = ScreenCaptureService.deckIds;
        String[] names = ScreenCaptureService.deckNames;
        if (ids.length == 0) return;

        String lowerQuery = query.toLowerCase();
        String chosungQuery = extractChosung(query);
        boolean isChosungOnly = isAllChosung(query);

        List<int[]> matches = new ArrayList<>(); // [index, priority]

        for (int i = 0; i < names.length && matches.size() < 20; i++) {
            String name = names[i];
            String lowerName = name.toLowerCase();

            // Exact substring match (highest priority)
            if (lowerName.contains(lowerQuery)) {
                matches.add(new int[]{i, 0});
                continue;
            }

            // Chosung match
            if (isChosungOnly && chosungQuery.length() > 0) {
                String nameChosung = extractChosung(name);
                if (nameChosung.contains(chosungQuery)) {
                    matches.add(new int[]{i, 1});
                }
            }
        }

        // Sort by priority then show top 4
        matches.sort((a, b) -> a[1] - b[1]);
        int shown = 0;
        for (int[] m : matches) {
            if (shown >= 4) break;
            final int idx = m[0];
            final int deckId = ids[idx];
            final String deckName = names[idx];

            TextView btn = new TextView(context);
            btn.setText(deckName);
            btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            btn.setTextColor(TEXT_WHITE);
            btn.setBackground(roundedBg(0xFF383838, 4));
            btn.setPadding(dp(10), dp(6), dp(10), dp(6));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.topMargin = dp(2);
            btn.setLayoutParams(lp);
            btn.setOnClickListener(v -> {
                selectedOpponentDeckId = deckId;
                ScreenCaptureService.overlayOpponentDeckId = deckId;
                selectedDeckLabel.setText("vs " + deckName);
                selectedDeckLabel.setVisibility(View.VISIBLE);
                searchInput.setText("");
                searchResults.removeAllViews();
                hideKeyboard();
            });
            searchResults.addView(btn);
            shown++;
        }
    }

    // === Korean chosung utilities ===

    private static String extractChosung(String text) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c >= 0xAC00 && c <= 0xD7A3) {
                int idx = (c - 0xAC00) / (21 * 28);
                sb.append(CHOSUNG[idx]);
            } else if (isChosungChar(c)) {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    private static boolean isAllChosung(String text) {
        if (text.isEmpty()) return false;
        for (int i = 0; i < text.length(); i++) {
            if (!isChosungChar(text.charAt(i))) return false;
        }
        return true;
    }

    private static boolean isChosungChar(char c) {
        return c >= 0x3131 && c <= 0x314E;
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

    // === Sync ===

    private void syncOverlayValues() {
        ScreenCaptureService.overlayCoin = currentCoin;
        ScreenCaptureService.overlayFS = currentFS;
        ScreenCaptureService.overlayResult = currentResult;
        ScreenCaptureService.overlayOpponentDeckId = selectedOpponentDeckId;
    }

    // === UI helpers ===

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

    // === View factories ===

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
        v.setLayoutParams(new LinearLayout.LayoutParams(dp(widthDp), dp(widthDp)));
        return v;
    }

    private LinearLayout makeEditRow(String label) {
        LinearLayout row = new LinearLayout(context);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        TextView tv = new TextView(context);
        tv.setText(label);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        tv.setTextColor(TEXT_DIM);
        tv.setWidth(dp(40));
        row.addView(tv);
        return row;
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
        hideKeyboard();
        if (rootLayout != null) {
            try { windowManager.removeView(rootLayout); } catch (Exception ignored) {}
            rootLayout = null;
        }
    }
}
