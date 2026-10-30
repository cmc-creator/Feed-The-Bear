package com.feedthebear.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Android forgets geofences on restart and on app updates; put them back. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            GeofenceStore.registerSaved(context);
        }
    }
}
