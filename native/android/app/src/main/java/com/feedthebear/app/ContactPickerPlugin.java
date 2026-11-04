package com.feedthebear.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * "Pick from contacts" when sending an invite (friends.js). Opens the phone's
 * own contact picker; the person taps one contact and the app gets only that
 * contact's name. The picker grants read access to just that one contact, so
 * no READ_CONTACTS permission is needed, and nothing else is read.
 */
@CapacitorPlugin(name = "ContactPicker")
public class ContactPickerPlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.Contacts.CONTENT_URI);
        try {
            startActivityForResult(call, intent, "picked");
        } catch (ActivityNotFoundException e) {
            call.reject("No contacts app");
        }
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject out = new JSObject();
        String name = "";
        Intent data = result.getData();
        Uri uri = data != null ? data.getData() : null;
        if (result.getResultCode() == Activity.RESULT_OK && uri != null) {
            try (Cursor c = getContext().getContentResolver().query(uri, new String[] { ContactsContract.Contacts.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            } catch (Exception e) { /* no name: they can type it */ }
        }
        out.put("name", name == null ? "" : name);
        call.resolve(out);
    }
}
