package com.feedthebear.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Loads the live site (capacitor.config.json server.url) and routes what
 * opens the app into it:
 *   - a tapped nearby notification   → app.html?spot=<id>
 *   - back from Google sign-in       → app.html#native-auth=<token> (firebase.js signs in)
 *   - a Feed The Bear link            → that page
 *   - a post shared from TikTok etc. → app.html?text=<shared text> (Add a spot reads it)
 */
public class MainActivity extends BridgeActivity {
    static final String EXTRA_SPOT = "ftb_spot";
    static volatile boolean inForeground = false;
    private static final String APP_URL = "https://www.feed-the-bear.com/app.html";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NearbyAlertsPlugin.class);
        super.onCreate(savedInstanceState);
        route(getIntent());
        // Geofences may have been cleared (reboot, update, or Play services reset).
        GeofenceStore.registerSaved(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        route(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        inForeground = true;
    }

    @Override
    public void onPause() {
        inForeground = false;
        super.onPause();
    }

    private void load(String url) {
        if (getBridge() != null) getBridge().getWebView().loadUrl(url);
    }

    private void route(Intent intent) {
        if (intent == null) return;
        String spot = intent.getStringExtra(EXTRA_SPOT);
        if (spot != null && !spot.isEmpty()) {
            intent.removeExtra(EXTRA_SPOT);
            load(APP_URL + "?spot=" + Uri.encode(spot));
            return;
        }
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            intent.setAction(null);
            if (text != null && !text.isEmpty()) load(APP_URL + "?text=" + Uri.encode(text.length() > 1500 ? text.substring(0, 1500) : text));
            return;
        }
        Uri data = intent.getData();
        if (data == null) return;
        intent.setData(null);
        if ("com.feedthebear.app".equals(data.getScheme()) && "signin".equals(data.getHost())) {
            String token = data.getQueryParameter("t");
            if (token != null && token.matches("[A-Za-z0-9._-]{20,4000}")) load(APP_URL + "#native-auth=" + token);
        } else if ("https".equals(data.getScheme()) && "www.feed-the-bear.com".equals(data.getHost())) {
            load(data.toString());
        }
    }
}
