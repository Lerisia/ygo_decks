package com.elyss.ygodecks.plugins.tracker;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.activity.result.ActivityResult;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DuelTracker")
public class DuelTrackerPlugin extends Plugin {

    private static final String TAG = "DuelTracker";
    private static final String CALLBACK_TAG = "screenCaptureResult";
    private static final int NOTIFICATION_PERMISSION_CODE = 9001;

    @PluginMethod()
    public void startTracking(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }

        Log.d(TAG, "startTracking called");

        // 1. Check notification permission (Android 13+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                Log.d(TAG, "Requesting notification permission");
                ActivityCompat.requestPermissions(activity,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        NOTIFICATION_PERMISSION_CODE);
                call.reject("Notification permission required. Please grant and try again.");
                return;
            }
        }

        // 2. Check overlay permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(activity)) {
            Log.d(TAG, "Requesting overlay permission");
            Intent overlayIntent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(overlayIntent);
            call.reject("Overlay permission required. Please grant and try again.");
            return;
        }

        // 3. Request screen capture
        Log.d(TAG, "Requesting screen capture permission");
        MediaProjectionManager mgr = (MediaProjectionManager)
                activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE);

        Intent intent = mgr.createScreenCaptureIntent();
        startActivityForResult(call, intent, CALLBACK_TAG);
    }

    @ActivityCallback
    private void screenCaptureResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        Log.d(TAG, "screenCaptureResult: resultCode=" + result.getResultCode());

        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            try {
                Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
                serviceIntent.putExtra("resultCode", result.getResultCode());
                serviceIntent.putExtra("data", result.getData());
                getContext().startForegroundService(serviceIntent);
                Log.d(TAG, "ScreenCaptureService started");

                JSObject ret = new JSObject();
                ret.put("started", true);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "Failed to start service", e);
                call.reject("Failed to start tracking: " + e.getMessage());
            }
        } else {
            Log.w(TAG, "Screen capture permission denied");
            call.reject("Screen capture permission denied");
        }
    }

    @PluginMethod()
    public void stopTracking(PluginCall call) {
        try {
            Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
            getContext().stopService(serviceIntent);
            Log.d(TAG, "ScreenCaptureService stopped");
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
