package com.elyss.ygodecks;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.elyss.ygodecks.plugins.tracker.DuelTrackerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DuelTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
