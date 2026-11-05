package com.feedthebear.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;

/**
 * What Android's web view can't do by itself, for the site's buttons (app.js
 * fills in navigator.share, file downloads, window.print and window.open):
 *   share     text and links → the phone's share sheet (Messages, WhatsApp…)
 *   shareFile an image or file → the share sheet, which also offers saving it
 *   openUrl   Maps, Directions, restaurant sites → the right app or Chrome
 *   print     the printable report → Android's print / Save as PDF
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
        choose(call, send, title);
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = call.getString("name", "file");
        String mime = call.getString("mime", "application/octet-stream");
        String data = call.getString("base64", "");
        String title = call.getString("title", "");
        String text = call.getString("text", "");
        if (data.isEmpty()) { call.reject("No file"); return; }
        try {
            File dir = new File(getContext().getCacheDir(), "shared");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("No cache folder");
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            File file = new File(dir, name.replaceAll("[^A-Za-z0-9._-]", "_"));
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(Base64.decode(data, Base64.DEFAULT));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            if (!text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
            if (!title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            choose(call, send, title);
        } catch (Exception e) {
            call.reject("Could not share the file");
        }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (url.isEmpty()) { call.reject("No link"); return; }
        Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(view);
            call.resolve();
        } catch (Exception e) {
            call.reject("No app can open this link");
        }
    }

    @PluginMethod
    public void print(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                WebView web = getBridge().getWebView();
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                String job = call.getString("title", "Feed The Bear");
                pm.print(job, web.createPrintDocumentAdapter(job), null);
                call.resolve();
            } catch (Exception e) {
                call.reject("Printing isn't available");
            }
        });
    }

    private void choose(PluginCall call, Intent send, String title) {
        Intent chooser = Intent.createChooser(send, title.isEmpty() ? "Share" : title);
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("No app to share with");
        }
    }
}
