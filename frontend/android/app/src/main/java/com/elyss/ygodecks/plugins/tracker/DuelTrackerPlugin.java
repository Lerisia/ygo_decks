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
import android.widget.Toast;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DuelTracker")
public class DuelTrackerPlugin extends Plugin {

    private static final String TAG = "DuelTracker";
    private static final int SCREEN_CAPTURE_REQUEST = 1001;
    private PluginCall savedCall = null;

    @PluginMethod()
    public void startTracking(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }

        Log.d(TAG, "startTracking called");
        Toast.makeText(activity, "트래커: 권한 요청 중...", Toast.LENGTH_SHORT).show();

        // Check notification permission (Android 13+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                activity.requestPermissions(
                        new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 9001);
                call.reject("알림 권한이 필요합니다. 권한을 허용한 후 다시 시도해주세요.");
                return;
            }
        }

        // Check overlay permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(activity)) {
            Intent overlayIntent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(overlayIntent);
            call.reject("오버레이 권한이 필요합니다. 권한을 허용한 후 다시 시도해주세요.");
            return;
        }

        // Save call and request screen capture
        savedCall = call;
        MediaProjectionManager mgr = (MediaProjectionManager)
                activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        Intent intent = mgr.createScreenCaptureIntent();

        Log.d(TAG, "Launching screen capture intent");
        Toast.makeText(activity, "트래커: 화면 공유 요청", Toast.LENGTH_SHORT).show();

        activity.startActivityForResult(intent, SCREEN_CAPTURE_REQUEST);
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);

        Log.d(TAG, "handleOnActivityResult: requestCode=" + requestCode + " resultCode=" + resultCode);

        if (requestCode != SCREEN_CAPTURE_REQUEST) return;

        Activity activity = getActivity();

        if (resultCode == Activity.RESULT_OK && data != null) {
            try {
                Toast.makeText(activity, "트래커: 서비스 시작 중...", Toast.LENGTH_SHORT).show();

                Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
                serviceIntent.putExtra("resultCode", resultCode);
                serviceIntent.putExtra("data", data);
                getContext().startForegroundService(serviceIntent);

                Log.d(TAG, "Service started successfully");
                Toast.makeText(activity, "트래커: 시작됨!", Toast.LENGTH_SHORT).show();

                if (savedCall != null) {
                    JSObject ret = new JSObject();
                    ret.put("started", true);
                    savedCall.resolve(ret);
                    savedCall = null;
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to start service", e);
                String msg = "서비스 시작 실패: " + e.getMessage();
                Toast.makeText(activity, msg, Toast.LENGTH_LONG).show();

                if (savedCall != null) {
                    savedCall.reject(msg);
                    savedCall = null;
                }
            }
        } else {
            Log.w(TAG, "Screen capture denied");
            Toast.makeText(activity, "화면 공유가 거부되었습니다", Toast.LENGTH_SHORT).show();

            if (savedCall != null) {
                savedCall.reject("화면 공유가 거부되었습니다");
                savedCall = null;
            }
        }
    }

    @PluginMethod()
    public void stopTracking(PluginCall call) {
        try {
            Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
            getContext().stopService(serviceIntent);
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop service", e);
        }

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
        ret.put("status", ScreenCaptureService.statusLog);
        call.resolve(ret);
    }
}
