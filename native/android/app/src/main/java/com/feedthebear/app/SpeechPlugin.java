package com.feedthebear.app;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * Voice input for the search mic and Byte Cub's mic (app.js). Android's web
 * view has no speech recognition, so app.js wraps this in the same shape as
 * the browser's SpeechRecognition. Words heard so far arrive as "partial"
 * events; start() resolves with the final text or rejects with the browser's
 * error names (no-speech, not-allowed, network, audio-capture, aborted).
 */
@CapacitorPlugin(
    name = "Speech",
    permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class SpeechPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private PluginCall active;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject out = new JSObject();
        out.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(out);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micDone");
            return;
        }
        listen(call);
    }

    @PermissionCallback
    private void micDone(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) listen(call);
        else call.reject("Microphone not allowed", "not-allowed");
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> { if (recognizer != null) recognizer.stopListening(); });
        call.resolve();
    }

    @PluginMethod
    public void abort(PluginCall call) {
        main.post(() -> finish(null, "aborted"));
        call.resolve();
    }

    private void listen(PluginCall call) {
        call.setKeepAlive(true);
        main.post(() -> {
            finish(null, "aborted");
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                call.reject("Speech recognition unavailable", "service-not-allowed");
                return;
            }
            active = call;
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new Listener());
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("lang", "en-US"));
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            recognizer.startListening(intent);
        });
    }

    // Ends the current listen: resolves with text, or rejects with an error name.
    private void finish(String text, String error) {
        PluginCall call = active;
        active = null;
        if (recognizer != null) {
            try { recognizer.destroy(); } catch (Exception e) { /* already gone */ }
            recognizer = null;
        }
        if (call == null) return;
        call.setKeepAlive(false);
        if (error != null) { call.reject(error, error); return; }
        JSObject out = new JSObject();
        out.put("text", text == null ? "" : text);
        call.resolve(out);
    }

    private static String first(Bundle results) {
        ArrayList<String> list = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return list == null || list.isEmpty() ? "" : list.get(0);
    }

    private static String errorName(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "no-speech";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "not-allowed";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER: return "network";
            case SpeechRecognizer.ERROR_AUDIO: return "audio-capture";
            case SpeechRecognizer.ERROR_CLIENT: return "aborted";
            default: return "no-speech";
        }
    }

    private class Listener implements RecognitionListener {
        @Override public void onPartialResults(Bundle partial) {
            JSObject out = new JSObject();
            out.put("text", first(partial));
            notifyListeners("partial", out);
        }
        @Override public void onResults(Bundle results) { finish(first(results), null); }
        @Override public void onError(int error) { finish(null, errorName(error)); }
        @Override public void onReadyForSpeech(Bundle params) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int eventType, Bundle params) {}
    }
}
