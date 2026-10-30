package com.feedthebear.app;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The web app (app.js, NativeAlerts) hands its Want to Try spots and the
 * chosen distance to Android here; GeofenceStore registers them with the
 * system so alerts arrive even when the app is closed.
 */
@CapacitorPlugin(
    name = "NearbyAlerts",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }),
        @Permission(alias = "background", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class NearbyAlertsPlugin extends Plugin {

    private JSObject statusObject() {
        JSObject out = new JSObject();
        out.put("location", getPermissionState("location") == PermissionState.GRANTED);
        out.put("background", Build.VERSION.SDK_INT < 29 || getPermissionState("background") == PermissionState.GRANTED);
        out.put("notifications", Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED);
        out.put("registered", GeofenceStore.registeredCount(getContext()));
        return out;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void requestLocation(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) { call.resolve(statusObject()); return; }
        requestPermissionForAlias("location", call, "permissionDone");
    }

    // Android 11+ only offers "Allow all the time" on the app's settings page,
    // so the app explains why first (see app.js) and then this opens it.
    @PluginMethod
    public void requestBackground(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29 || getPermissionState("background") == PermissionState.GRANTED) { call.resolve(statusObject()); return; }
        if (getPermissionState("location") != PermissionState.GRANTED) { call.reject("Allow location first"); return; }
        if (Build.VERSION.SDK_INT >= 30) {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(statusObject());
        } else {
            requestPermissionForAlias("background", call, "permissionDone");
        }
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) { call.resolve(statusObject()); return; }
        requestPermissionForAlias("notifications", call, "permissionDone");
    }

    @PermissionCallback
    private void permissionDone(PluginCall call) {
        GeofenceStore.registerSaved(getContext());
        call.resolve(statusObject());
    }

    /** { enabled, radiusMeters, spots: [{ id, name, lat, lng }] }, nearest first, at most 100. */
    @PluginMethod
    public void setSpots(PluginCall call) {
        try {
            boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
            double radius = call.getDouble("radiusMeters", 16093.0);
            JSArray spots = call.getArray("spots", new JSArray());
            JSONArray clean = new JSONArray();
            for (int i = 0; i < spots.length() && clean.length() < GeofenceStore.MAX_SPOTS; i++) {
                JSONObject s = spots.getJSONObject(i);
                if (!s.has("lat") || !s.has("lng") || s.isNull("lat") || s.isNull("lng")) continue;
                JSONObject c = new JSONObject();
                c.put("id", s.optString("id"));
                c.put("name", s.optString("name"));
                c.put("lat", s.getDouble("lat"));
                c.put("lng", s.getDouble("lng"));
                clean.put(c);
            }
            GeofenceStore.save(getContext(), enabled, radius, clean);
            GeofenceStore.registerSaved(getContext());
            call.resolve(statusObject());
        } catch (Exception e) {
            call.reject("Could not set up nearby alerts: " + e.getMessage());
        }
    }
}
