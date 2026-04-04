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
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

public class DetectionOverlay {

    private final WindowManager windowManager;
    private final Context context;
    private final Handler handler;

    // Main overlay
    private LinearLayout rootLayout;
    private TextView statusView;
    private TextView manualToggleBtn;
    private TextView cancelGameBtn;
    private LinearLayout manualPanel;  // Dynamic content panel
    private boolean manualPanelOpen = false;
    private String manualCoin = null;  // null = not yet selected
    private LinearLayout resultLayout;
    private TextView countdownView;
    private TextView coinLabel, fsLabel, resultLabel;
    private TextView rankChangeView;
    private LinearLayout editLayout;
    private TextView coinWinBtn, coinLoseBtn;
    private TextView fsFirstBtn, fsSecondBtn;
    private TextView resultWinBtn, resultLoseBtn;
    private TextView saveBtn, dismissBtn;
    private TextView selectedDeckLabel;

    // Search overlay (separate window)
    private LinearLayout searchRoot;
    private EditText searchInput;
    private LinearLayout searchResults;

    private boolean isExpanded = false;
    private boolean isEditMode = false;
    private int selectedOpponentDeckId = -1;

    private int countdownSeconds = 0;
    private Runnable countdownRunnable;

    private String currentCoin = null;
    private String currentFS = null;
    private String currentResult = null;
    private String currentRatingScore = null;

    private static final int BG_COLOR = 0xE6222222;
    private static final int ACCENT_BLUE = 0xFF3B82F6;
    private static final int ACCENT_RED = 0xFFEF4444;
    private static final int ACCENT_GREEN = 0xFF22C55E;
    private static final int TEXT_WHITE = 0xFFFFFFFF;
    private static final int TEXT_DIM = 0xFF999999;
    private static final int BTN_INACTIVE = 0xFF444444;

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

        // Status row: status text + manual toggle button
        LinearLayout statusRow = new LinearLayout(context);
        statusRow.setOrientation(LinearLayout.HORIZONTAL);
        statusRow.setGravity(Gravity.CENTER);

        statusView = new TextView(context);
        statusView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        statusView.setTextColor(TEXT_DIM);
        statusView.setText("대기 중");
        statusRow.addView(statusView);

        manualToggleBtn = new TextView(context);
        manualToggleBtn.setText("수동");
        manualToggleBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        manualToggleBtn.setTextColor(TEXT_DIM);
        manualToggleBtn.setBackground(roundedBg(0xFF333333, 4));
        manualToggleBtn.setPadding(dp(8), dp(3), dp(8), dp(3));
        manualToggleBtn.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams toggleLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        toggleLp.leftMargin = dp(8);
        manualToggleBtn.setLayoutParams(toggleLp);
        manualToggleBtn.setOnClickListener(v -> toggleManualPanel());
        statusRow.addView(manualToggleBtn);

        rootLayout.addView(statusRow);

        // === Manual panel (dynamic content) ===
        manualPanel = new LinearLayout(context);
        manualPanel.setOrientation(LinearLayout.HORIZONTAL);
        manualPanel.setGravity(Gravity.CENTER);
        manualPanel.setVisibility(View.GONE);
        manualPanel.setPadding(0, dp(6), 0, 0);
        rootLayout.addView(manualPanel);

        // === Cancel game button (visible during IN_DUEL) ===
        cancelGameBtn = new TextView(context);
        cancelGameBtn.setText("취소");
        cancelGameBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        cancelGameBtn.setTextColor(ACCENT_RED);
        cancelGameBtn.setBackground(roundedBg(0xFF331111, 4));
        cancelGameBtn.setPadding(dp(10), dp(4), dp(10), dp(4));
        cancelGameBtn.setGravity(Gravity.CENTER);
        cancelGameBtn.setVisibility(View.GONE);
        cancelGameBtn.setOnClickListener(v -> onCancelGame());
        rootLayout.addView(cancelGameBtn);

        // Result layout
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
        editBtn.setText("수정");
        editBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        editBtn.setTextColor(ACCENT_BLUE);
        editBtn.setBackground(roundedBg(0xFF333333, 6));
        editBtn.setPadding(dp(12), dp(8), dp(12), dp(8));
        editBtn.setOnClickListener(v -> toggleEditMode());
        LinearLayout.LayoutParams editLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        editLp.leftMargin = dp(8);
        editBtn.setLayoutParams(editLp);
        summaryRow.addView(editBtn);

        resultLayout.addView(summaryRow);

        // Rank change
        rankChangeView = new TextView(context);
        rankChangeView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        rankChangeView.setGravity(Gravity.CENTER);
        rankChangeView.setVisibility(View.GONE);
        rankChangeView.setPadding(0, dp(2), 0, dp(2));
        resultLayout.addView(rankChangeView);

        // Opponent deck label
        selectedDeckLabel = new TextView(context);
        selectedDeckLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        selectedDeckLabel.setTextColor(0xFFAABBCC);
        selectedDeckLabel.setGravity(Gravity.CENTER);
        selectedDeckLabel.setVisibility(View.GONE);
        resultLayout.addView(selectedDeckLabel);

        // Edit layout
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

        // Search button (opens separate search overlay)
        TextView searchBtn = new TextView(context);
        searchBtn.setText("상대 덱 검색");
        searchBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        searchBtn.setTextColor(ACCENT_BLUE);
        searchBtn.setBackground(roundedBg(0xFF333333, 6));
        searchBtn.setPadding(dp(12), dp(6), dp(12), dp(6));
        searchBtn.setGravity(Gravity.CENTER);
        searchBtn.setOnClickListener(v -> openSearchOverlay());
        editLayout.addView(searchBtn);
        editLayout.addView(makeSpacer(6));

        // Action buttons
        LinearLayout actionRow = new LinearLayout(context);
        actionRow.setOrientation(LinearLayout.HORIZONTAL);
        actionRow.setGravity(Gravity.CENTER);

        saveBtn = makeActionBtn("저장", ACCENT_GREEN);
        saveBtn.setOnClickListener(v -> {
            syncOverlayValues();
            ScreenCaptureService.overlayAction = "save";
            closeSearchOverlay();
            collapseToStatus("저장 완료");
        });

        dismissBtn = makeActionBtn("폐기", 0xFF666666);
        dismissBtn.setOnClickListener(v -> {
            ScreenCaptureService.overlayAction = "dismiss";
            closeSearchOverlay();
            collapseToStatus("무시됨");
        });

        actionRow.addView(saveBtn);
        actionRow.addView(makeSpacer(8));
        actionRow.addView(dismissBtn);
        editLayout.addView(actionRow);

        resultLayout.addView(editLayout);
        rootLayout.addView(resultLayout);

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                layoutType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.x = 0;
        params.y = 0;

        try {
            windowManager.addView(rootLayout, params);
        } catch (Exception e) {
            rootLayout = null;
        }
    }

    // === Search overlay (separate window on the right) ===

    private void openSearchOverlay() {
        if (searchRoot != null) return;

        searchRoot = new LinearLayout(context);
        searchRoot.setOrientation(LinearLayout.VERTICAL);
        searchRoot.setBackground(roundedBg(BG_COLOR, 10));
        searchRoot.setPadding(dp(10), dp(8), dp(10), dp(8));

        searchInput = new EditText(context);
        searchInput.setHint("초성 검색");
        searchInput.setHintTextColor(0xFF666666);
        searchInput.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        searchInput.setTextColor(TEXT_WHITE);
        searchInput.setBackground(roundedBg(0xFF333333, 6));
        searchInput.setPadding(dp(8), dp(6), dp(8), dp(6));
        searchInput.setSingleLine(true);
        searchInput.setImeOptions(EditorInfo.IME_FLAG_NO_EXTRACT_UI | EditorInfo.IME_FLAG_NO_FULLSCREEN);
        searchInput.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
            @Override public void onTextChanged(CharSequence s, int st, int b, int c) {}
            @Override public void afterTextChanged(Editable s) { onSearchChanged(s.toString()); }
        });
        searchRoot.addView(searchInput);

        searchResults = new LinearLayout(context);
        searchResults.setOrientation(LinearLayout.VERTICAL);

        ScrollView scroll = new ScrollView(context);
        scroll.addView(searchResults);
        LinearLayout.LayoutParams scrollLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(120));
        scroll.setLayoutParams(scrollLp);
        searchRoot.addView(scroll);

        // Close button
        TextView closeBtn = new TextView(context);
        closeBtn.setText("닫기");
        closeBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        closeBtn.setTextColor(TEXT_DIM);
        closeBtn.setGravity(Gravity.CENTER);
        closeBtn.setPadding(0, dp(4), 0, 0);
        closeBtn.setOnClickListener(v -> closeSearchOverlay());
        searchRoot.addView(closeBtn);

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                dp(180),
                WindowManager.LayoutParams.WRAP_CONTENT,
                layoutType(),
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.END;
        params.x = dp(8);
        params.y = dp(60);
        params.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;

        try {
            windowManager.addView(searchRoot, params);
            searchInput.requestFocus();
            handler.postDelayed(() -> {
                InputMethodManager imm = (InputMethodManager) context.getSystemService(Context.INPUT_METHOD_SERVICE);
                if (imm != null) imm.showSoftInput(searchInput, InputMethodManager.SHOW_IMPLICIT);
            }, 200);
        } catch (Exception e) {
            searchRoot = null;
        }
    }

    private void closeSearchOverlay() {
        if (searchRoot != null) {
            InputMethodManager imm = (InputMethodManager) context.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null && searchInput != null) imm.hideSoftInputFromWindow(searchInput.getWindowToken(), 0);
            try { windowManager.removeView(searchRoot); } catch (Exception ignored) {}
            searchRoot = null;
            searchInput = null;
            searchResults = null;
        }
    }

    // === Public API ===

    public void updateStatus(String text) {
        handler.post(() -> {
            ensureRoot();
            if (rootLayout == null) return;
            if (!isExpanded) {
                statusView.setText(text);
                // Show cancel button during in-duel (auto or manual)
                ScreenAnalyzer.State state = ScreenAnalyzer.getCurrentState();
                boolean isDuel = (state == ScreenAnalyzer.State.IN_DUEL) || manualMode;
                cancelGameBtn.setVisibility(isDuel ? View.VISIBLE : View.GONE);
                manualToggleBtn.setVisibility(View.VISIBLE);
            } else {
                updateSummaryLabels();
                manualToggleBtn.setVisibility(View.GONE);
                cancelGameBtn.setVisibility(View.GONE);
            }
        });
    }

    public void showResult(String coin, String fs, String result) {
        showResultWithRating(coin, fs, result, null);
    }

    public void showResultWithRating(String coin, String fs, String result, String ratingScore) {
        handler.post(() -> {
            ensureRoot();
            if (rootLayout == null) return;

            currentCoin = coin;
            currentFS = fs;
            currentResult = result;
            currentRatingScore = ratingScore;
            selectedOpponentDeckId = -1;
            syncOverlayValues();

            updateSummaryLabels();
            selectedDeckLabel.setVisibility(View.GONE);

            statusView.setVisibility(View.GONE);
            manualPanel.setVisibility(View.GONE);
            manualToggleBtn.setVisibility(View.GONE);
            cancelGameBtn.setVisibility(View.GONE);
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
            manualMode = false;
            closeManualPanel();
            cancelGameBtn.setVisibility(View.GONE);
            statusView.setText(msg);
            statusView.setVisibility(View.VISIBLE);
            resultLayout.setVisibility(View.GONE);
            editLayout.setVisibility(View.GONE);
            manualToggleBtn.setVisibility(View.VISIBLE);
        });
    }

    private void toggleEditMode() {
        if (!isEditMode) {
            stopCountdown();
            countdownView.setText("수정 중");
            editLayout.setVisibility(View.VISIBLE);
            updateEditButtons();
            isEditMode = true;
        } else {
            editLayout.setVisibility(View.GONE);
            closeSearchOverlay();
            isEditMode = false;
            updateSummaryLabels();
            startCountdown(5);
        }
    }

    // === Manual controls ===

    private boolean manualMode = false;
    private int manualStep = 0; // 0=closed, 1=coin, 2=fs (waiting) or 1=result (duel)

    private void toggleManualPanel() {
        if (manualPanelOpen) {
            closeManualPanel();
        } else {
            openManualPanel();
        }
    }

    private void openManualPanel() {
        manualPanelOpen = true;
        manualCoin = null;
        manualToggleBtn.setTextColor(ACCENT_BLUE);

        ScreenAnalyzer.State state = ScreenAnalyzer.getCurrentState();
        boolean isDuel = (state == ScreenAnalyzer.State.IN_DUEL) || manualMode;

        if (isDuel) {
            showManualResultButtons();
        } else {
            showManualCoinButtons();
        }
    }

    private void closeManualPanel() {
        manualPanelOpen = false;
        manualPanel.setVisibility(View.GONE);
        manualPanel.removeAllViews();
        manualToggleBtn.setTextColor(TEXT_DIM);
    }

    private void showManualCoinButtons() {
        manualPanel.removeAllViews();
        manualPanel.setVisibility(View.VISIBLE);

        TextView label = new TextView(context);
        label.setText("코인 ");
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        label.setTextColor(TEXT_DIM);
        manualPanel.addView(label);

        TextView winBtn = makeToggleBtn("앞면");
        winBtn.setOnClickListener(v -> { manualCoin = "win"; showManualFsButtons(); });
        manualPanel.addView(winBtn);
        manualPanel.addView(makeSpacer(4));

        TextView loseBtn = makeToggleBtn("뒷면");
        loseBtn.setOnClickListener(v -> { manualCoin = "lose"; showManualFsButtons(); });
        manualPanel.addView(loseBtn);
    }

    private void showManualFsButtons() {
        manualPanel.removeAllViews();

        TextView label = new TextView(context);
        label.setText("순서 ");
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        label.setTextColor(TEXT_DIM);
        manualPanel.addView(label);

        TextView firstBtn = makeToggleBtn("선공");
        firstBtn.setOnClickListener(v -> onManualGameStart("first"));
        manualPanel.addView(firstBtn);
        manualPanel.addView(makeSpacer(4));

        TextView secondBtn = makeToggleBtn("후공");
        secondBtn.setOnClickListener(v -> onManualGameStart("second"));
        manualPanel.addView(secondBtn);
    }

    private void showManualResultButtons() {
        manualPanel.removeAllViews();
        manualPanel.setVisibility(View.VISIBLE);

        TextView winBtn = makeActionBtn("승리", ACCENT_GREEN);
        winBtn.setOnClickListener(v -> onManualResult("win"));
        manualPanel.addView(winBtn);
        manualPanel.addView(makeSpacer(10));

        TextView loseBtn = makeActionBtn("패배", ACCENT_RED);
        loseBtn.setOnClickListener(v -> onManualResult("lose"));
        manualPanel.addView(loseBtn);
    }

    private void onManualGameStart(String fs) {
        ScreenCaptureService.lastCoinToss = manualCoin;
        ScreenCaptureService.lastFirstSecond = fs;
        ScreenCaptureService.lastDetectionTime = System.currentTimeMillis();
        manualMode = true;

        closeManualPanel();

        String coinStr = "win".equals(manualCoin) ? "앞면" : "뒷면";
        String fsStr = "first".equals(fs) ? "선공" : "후공";
        statusView.setText(coinStr + " / " + fsStr + "  게임 중");
        cancelGameBtn.setVisibility(View.VISIBLE);
    }

    private void onManualResult(String result) {
        closeManualPanel();

        String coin = manualMode ? manualCoin : ScreenCaptureService.lastCoinToss;
        String fs = manualMode ? ScreenCaptureService.lastFirstSecond : ScreenCaptureService.lastFirstSecond;
        manualMode = false;

        // Calculate rank
        String rankValue = ScreenCaptureService.currentRankValue;
        int winsValue = ScreenCaptureService.currentWinsValue;
        if (rankValue != null && !rankValue.isEmpty()) {
            boolean isWin = "win".equals(result);
            String beforeDisplay = RankCalculator.formatDisplay(rankValue, winsValue);
            String[] next = RankCalculator.getNextRankState(rankValue, winsValue, isWin);
            String afterDisplay = RankCalculator.formatDisplay(next[0], Integer.parseInt(next[1]));
            ScreenCaptureService.currentRankDisplay = beforeDisplay;
            ScreenCaptureService.previewRankDisplay = afterDisplay;
        }

        ScreenCaptureService.lastDuelResult = result;
        ScreenCaptureService.lastDetectionTime = System.currentTimeMillis();

        cancelGameBtn.setVisibility(View.GONE);
        showResult(coin, fs, result);
    }

    private void onCancelGame() {
        manualMode = false;
        closeManualPanel();
        cancelGameBtn.setVisibility(View.GONE);
        statusView.setText("대기 중");
        // Reset detection state
        ScreenCaptureService.lastCoinToss = null;
        ScreenCaptureService.lastFirstSecond = null;
        ScreenCaptureService.lastDuelResult = null;
    }

    // === Deck search ===

    private void onSearchChanged(String query) {
        if (searchResults == null) return;
        searchResults.removeAllViews();
        if (query.isEmpty()) return;

        int[] ids = ScreenCaptureService.deckIds;
        String[] names = ScreenCaptureService.deckNames;
        if (ids.length == 0) return;

        String lowerQuery = query.toLowerCase();
        String chosungQuery = extractChosung(query);
        boolean isChosungOnly = isAllChosung(query);

        List<int[]> matches = new ArrayList<>();

        for (int i = 0; i < names.length && matches.size() < 20; i++) {
            String lowerName = names[i].toLowerCase();
            if (lowerName.contains(lowerQuery)) {
                matches.add(new int[]{i, 0});
                continue;
            }
            if (isChosungOnly && chosungQuery.length() > 0) {
                String nameChosung = extractChosung(names[i]);
                if (nameChosung.contains(chosungQuery)) {
                    matches.add(new int[]{i, 1});
                }
            }
        }

        matches.sort((a, b) -> a[1] - b[1]);
        int shown = 0;
        for (int[] m : matches) {
            if (shown >= 5) break;
            final int idx = m[0];
            final int deckId = ids[idx];
            final String deckName = names[idx];

            TextView btn = new TextView(context);
            btn.setText(deckName);
            btn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            btn.setTextColor(TEXT_WHITE);
            btn.setBackground(roundedBg(0xFF383838, 4));
            btn.setPadding(dp(8), dp(6), dp(8), dp(6));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.topMargin = dp(2);
            btn.setLayoutParams(lp);
            btn.setOnClickListener(v -> {
                selectedOpponentDeckId = deckId;
                ScreenCaptureService.overlayOpponentDeckId = deckId;
                selectedDeckLabel.setText("vs " + deckName);
                selectedDeckLabel.setVisibility(View.VISIBLE);
                closeSearchOverlay();
            });
            searchResults.addView(btn);
            shown++;
        }
    }

    // === Korean chosung ===

    private static String extractChosung(String text) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c >= 0xAC00 && c <= 0xD7A3) {
                sb.append(CHOSUNG[(c - 0xAC00) / (21 * 28)]);
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
                    closeSearchOverlay();
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
        coinLabel.setText("win".equals(currentCoin) ? "앞면" : "뒷면");
        coinLabel.setTextColor("win".equals(currentCoin) ? 0xFFFFD700 : TEXT_WHITE);
        fsLabel.setText("first".equals(currentFS) ? "선공" : "후공");
        fsLabel.setTextColor(ACCENT_BLUE);
        String rText = "win".equals(currentResult) ? "승리" : "패배";
        if (currentRatingScore != null) {
            rText += " (" + currentRatingScore + ")";
        }
        resultLabel.setText(rText);
        resultLabel.setTextColor("win".equals(currentResult) ? ACCENT_GREEN : ACCENT_RED);

        String cur = ScreenCaptureService.currentRankDisplay;
        String preview = ScreenCaptureService.previewRankDisplay;
        if (cur != null && !cur.isEmpty()) {
            rankChangeView.setVisibility(View.VISIBLE);
            if (preview != null && !preview.isEmpty() && !preview.equals(cur)) {
                rankChangeView.setText(cur + " → " + preview);
            } else {
                rankChangeView.setText(cur);
            }
            rankChangeView.setTextColor(getRankColor(preview != null && !preview.isEmpty() ? preview : cur));
        } else {
            rankChangeView.setVisibility(View.GONE);
        }
    }

    private static int getRankColor(String rankDisplay) {
        if (rankDisplay == null) return TEXT_WHITE;
        if (rankDisplay.startsWith("루키")) return 0xFF90EE90;
        if (rankDisplay.startsWith("브론즈")) return 0xFFCD853F;
        if (rankDisplay.startsWith("실버")) return 0xFFC0C0C0;
        if (rankDisplay.startsWith("골드")) return 0xFFDAA520;
        if (rankDisplay.startsWith("플래티넘") || rankDisplay.startsWith("플레티넘")) return 0xFF50C878;
        if (rankDisplay.startsWith("다이아")) return 0xFFB39DDB;
        if (rankDisplay.startsWith("마스터")) return 0xFFFFD700;
        return TEXT_WHITE;
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

    private View makeSpacer(int sizeDp) {
        View v = new View(context);
        v.setLayoutParams(new LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp)));
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
        closeSearchOverlay();
        if (rootLayout != null) {
            try { windowManager.removeView(rootLayout); } catch (Exception ignored) {}
            rootLayout = null;
        }
    }
}
