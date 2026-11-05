package com.feedthebear.app;

import android.content.Intent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The phone's share sheet (Messages, WhatsApp, email…). Android's web view
 * has no navigator.share, so app.js fills it in with this, and every Share
 * and Invite button in the site works in the app.
 */
@CapacitorPlugin(name = "ShareSheet")
public class ShareSheetPlugin extends Plugin {

    @PluginMethod
    public void share(PluginCall call) {
        String title = call.getString("title", "");
        String text = call.getString("text", "");
        String url = call.getString("url", "");
        String body = (text + (text.isEmpty() || url.isEmpty() ? "" : " ") + url).trim();
        if (body.isEmpty()) { call.reject("Nothing to share"); return; }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, body);
        if (!title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
        Intent chooser = Intent.createChooser(send, title.isEmpty() ? "Share" : title);
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("No app to share with");
        }
    }
}
