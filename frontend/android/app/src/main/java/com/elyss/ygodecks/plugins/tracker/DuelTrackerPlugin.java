package com.elyss.ygodecks.plugins.tracker;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DuelTracker")
public class DuelTrackerPlugin extends Plugin {

    private static final String CALLBACK_TAG = "screenCaptureResult";

    @PluginMethod()
    public void startTracking(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }

        MediaProjectionManager mgr = (MediaProjectionManager)
                activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE);

        Intent intent = mgr.createScreenCaptureIntent();
        startActivityForResult(call, intent, CALLBACK_TAG);
    }

    @ActivityCallback
    private void screenCaptureResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
            serviceIntent.putExtra("resultCode", result.getResultCode());
            serviceIntent.putExtra("data", result.getData());
            getContext().startForegroundService(serviceIntent);

            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        } else {
            call.reject("Screen capture permission denied");
        }
    }

    @PluginMethod()
    public void stopTracking(PluginCall call) {
        Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
        getContext().stopService(serviceIntent);

        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    @PluginMethod()
    public void getLatestResult(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("coinToss", ScreenCaptureService.lastCoinToss);
        ret.put("duelResult", ScreenCaptureService.lastDuelResult);
        ret.put("timestamp", ScreenCaptureService.lastDetectionTime);
        call.resolve(ret);
    }
}
