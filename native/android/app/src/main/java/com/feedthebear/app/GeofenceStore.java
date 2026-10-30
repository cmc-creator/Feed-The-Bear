package com.feedthebear.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Keeps the Want to Try spots in SharedPreferences and registers them as
 * Android geofences. Geofences are cleared on reboot and app updates, so
 * BootReceiver calls registerSaved again.
 */
public final class GeofenceStore {
    static final int MAX_SPOTS = 100; // Android's limit per app
    private static final String PREFS = "ftb_nearby_alerts";

    private GeofenceStore() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void save(Context c, boolean enabled, double radius, JSONArray spots) {
        prefs(c).edit()
            .putBoolean("enabled", enabled)
            .putFloat("radius", (float) Math.max(200, Math.min(radius, 80467)))
            .putString("spots", spots.toString())
            .apply();
    }

    static JSONArray spots(Context c) {
        try { return new JSONArray(prefs(c).getString("spots", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    static String nameFor(Context c, String id) {
        JSONArray all = spots(c);
        for (int i = 0; i < all.length(); i++) {
            JSONObject s = all.optJSONObject(i);
            if (s != null && id.equals(s.optString("id"))) return s.optString("name");
        }
        return null;
    }

    static int registeredCount(Context c) {
        return prefs(c).getInt("registered", 0);
    }

    private static boolean canWatch(Context c) {
        boolean fine = ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean bg = Build.VERSION.SDK_INT < 29
            || ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
        return fine && bg;
    }

    private static PendingIntent pendingIntent(Context c) {
        Intent intent = new Intent(c, GeofenceReceiver.class);
        // Geofencing fills in the event extras, so this one must be mutable.
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        return PendingIntent.getBroadcast(c, 0, intent, flags);
    }

    @SuppressLint("MissingPermission") // checked in canWatch
    static void registerSaved(Context c) {
        GeofencingClient client = LocationServices.getGeofencingClient(c);
        PendingIntent pi = pendingIntent(c);
        client.removeGeofences(pi).addOnCompleteListener(done -> {
            SharedPreferences p = prefs(c);
            if (!p.getBoolean("enabled", false) || !canWatch(c)) { p.edit().putInt("registered", 0).apply(); return; }
            float radius = p.getFloat("radius", 16093f);
            JSONArray all = spots(c);
            List<Geofence> fences = new ArrayList<>();
            for (int i = 0; i < all.length() && fences.size() < MAX_SPOTS; i++) {
                JSONObject s = all.optJSONObject(i);
                if (s == null) continue;
                fences.add(new Geofence.Builder()
                    .setRequestId(s.optString("id"))
                    .setCircularRegion(s.optDouble("lat"), s.optDouble("lng"), radius)
                    .setExpirationDuration(Geofence.NEVER_EXPIRE)
                    .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER)
                    .setNotificationResponsiveness(5 * 60 * 1000) // battery-friendly
                    .build());
            }
            if (fences.isEmpty()) { p.edit().putInt("registered", 0).apply(); return; }
            // No initial trigger: setting this up while already near a spot shouldn't ping.
            GeofencingRequest request = new GeofencingRequest.Builder().setInitialTrigger(0).addGeofences(fences).build();
            client.addGeofences(request, pi)
                .addOnSuccessListener(v -> p.edit().putInt("registered", fences.size()).apply())
                .addOnFailureListener(e -> p.edit().putInt("registered", 0).apply());
        });
    }
}
