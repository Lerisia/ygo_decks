package com.elyss.ygodecks.plugins.tracker;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DuelTracker")
public class DuelTrackerPlugin extends Plugin {

    private static final String TAG = "DuelTracker";
    public static final int SCREEN_CAPTURE_REQUEST = 1001;
    private static PluginCall savedCall = null;
    public static String pluginStatus = "";

    @PluginMethod()
    public void startTracking(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) { call.reject("Activity not available"); return; }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                activity.requestPermissions(
                        new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 9001);
                call.reject("알림 권한이 필요합니다.");
                return;
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(activity)) {
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + activity.getPackageName())));
            call.reject("오버레이 권한이 필요합니다.");
            return;
        }

        savedCall = call;
        pluginStatus = "화면공유 요청 중";
        MediaProjectionManager mgr = (MediaProjectionManager)
                activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        activity.startActivityForResult(mgr.createScreenCaptureIntent(), SCREEN_CAPTURE_REQUEST);
    }

    public static void handleScreenCaptureResult(Activity activity, int requestCode, int resultCode, Intent data) {
        if (requestCode != SCREEN_CAPTURE_REQUEST) return;

        if (resultCode == Activity.RESULT_OK && data != null) {
            try {
                pluginStatus = "서비스 시작 요청";
                ScreenCaptureService.statusLog = "서비스 시작 중";
                Intent serviceIntent = new Intent(activity, ScreenCaptureService.class);
                serviceIntent.putExtra("resultCode", resultCode);
                serviceIntent.putExtra("data", data);
                activity.startForegroundService(serviceIntent);

                if (savedCall != null) {
                    JSObject ret = new JSObject();
                    ret.put("started", true);
                    savedCall.resolve(ret);
                    savedCall = null;
                }
            } catch (Exception e) {
                Log.e(TAG, "Service start failed", e);
                if (savedCall != null) {
                    savedCall.reject("서비스 시작 실패: " + e.getMessage());
                    savedCall = null;
                }
            }
        } else {
            if (savedCall != null) {
                savedCall.reject("화면 공유가 거부되었습니다");
                savedCall = null;
            }
        }
    }

    @PluginMethod()
    public void stopTracking(PluginCall call) {
        try { getContext().stopService(new Intent(getContext(), ScreenCaptureService.class)); }
        catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    @PluginMethod()
    public void getLatestResult(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("coinToss", ScreenCaptureService.lastCoinToss);
        ret.put("firstSecond", ScreenCaptureService.lastFirstSecond);
        ret.put("duelResult", ScreenCaptureService.lastDuelResult);
        ret.put("timestamp", ScreenCaptureService.lastDetectionTime);
        String status = ScreenCaptureService.statusLog;
        if (status == null || status.isEmpty()) {
            status = "svc:empty|plug:" + pluginStatus;
        }
        ret.put("status", status);

        // Overlay action (consumed once)
        String action = ScreenCaptureService.overlayAction;
        if (action != null) {
            ret.put("overlayAction", action);
            ret.put("overlayCoin", ScreenCaptureService.overlayCoin);
            ret.put("overlayFS", ScreenCaptureService.overlayFS);
            ret.put("overlayResult", ScreenCaptureService.overlayResult);
            // Clear after consumption
            ScreenCaptureService.overlayAction = null;
            ScreenCaptureService.overlayCoin = null;
            ScreenCaptureService.overlayFS = null;
            ScreenCaptureService.overlayResult = null;
            // Also clear detection state for next match
            ScreenCaptureService.lastCoinToss = null;
            ScreenCaptureService.lastFirstSecond = null;
            ScreenCaptureService.lastDuelResult = null;
        }

        call.resolve(ret);
    }
}
