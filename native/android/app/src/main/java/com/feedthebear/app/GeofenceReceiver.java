package com.feedthebear.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

/**
 * Android calls this when you come within range of a Want to Try spot.
 * Posts one notification; tapping it opens that spot in the app.
 */
public class GeofenceReceiver extends BroadcastReceiver {
    static final String CHANNEL = "nearby_want_to_try";
    private static final long SPOT_COOLDOWN = 3L * 24 * 60 * 60 * 1000; // same spot: at most every 3 days
    private static final long ANY_COOLDOWN = 2L * 60 * 60 * 1000;       // any spot: at most every two hours

    @Override
    public void onReceive(Context context, Intent intent) {
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null || event.hasError()) return;
        int t = event.getGeofenceTransition();
        if (t != Geofence.GEOFENCE_TRANSITION_ENTER && t != Geofence.GEOFENCE_TRANSITION_DWELL) return;
        if (MainActivity.inForeground) return; // the open app shows its own alert
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;

        SharedPreferences p = GeofenceStore.prefs(context);
        long now = System.currentTimeMillis();
        if (now - p.getLong("last_any", 0) < ANY_COOLDOWN) return;
        for (Geofence g : event.getTriggeringGeofences()) {
            String id = g.getRequestId();
            String name = GeofenceStore.nameFor(context, id);
            if (name == null || now - p.getLong("last_" + id, 0) < SPOT_COOLDOWN) continue;
            p.edit().putLong("last_" + id, now).putLong("last_any", now).apply();
            post(context, id, name + " is nearby", "It's on your Want to Try list. Tap to see it.");
            return; // one at a time
        }
    }

    /** One notification that opens spot `id`. Also used by the open app (NearbyAlertsPlugin.notify). */
    static void post(Context context, String id, String title, String text) {
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Nearby Want to Try spots", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("A heads-up when you're near a spot on your Want to Try list");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(context, MainActivity.class)
            .putExtra(MainActivity.EXTRA_SPOT, id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(context, id.hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_bear)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try {
            NotificationManagerCompat.from(context).notify(id.hashCode(), b.build());
        } catch (SecurityException ignored) {
            // notifications were turned off
        }
    }
}
