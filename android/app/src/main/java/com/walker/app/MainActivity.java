package com.walker.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocationBufferPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
