package com.elyss.ygodecks;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.elyss.ygodecks.plugins.tracker.DuelTrackerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DuelTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        DuelTrackerPlugin.handleScreenCaptureResult(this, requestCode, resultCode, data);
    }
}
