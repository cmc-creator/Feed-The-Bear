package com.feedthebear.app;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Google Play's US alternative billing: Grizzly is paid with Stripe, and each
 * sale made in the Play app is reported to Google (api/_play.js). Before
 * checkout, firebase.js calls checkoutToken(): Google shows its one-time
 * "this app uses another payment system" notice, then hands back a token
 * that goes with the Stripe checkout so the server can report the sale.
 *
 * Resolves { token } or { unavailable: true } (not installed from Play, not
 * enrolled, or not in the US), rejects "canceled" if the notice was dismissed.
 */
@CapacitorPlugin(name = "PlayBilling")
public class PlayBillingPlugin extends Plugin {
    private BillingClient client;

    @PluginMethod
    public void checkoutToken(PluginCall call) {
        if (client == null) client = BillingClient.newBuilder(getContext())
            .enableAlternativeBillingOnly()
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build();
        if (client.isReady()) { checkAvailable(call); return; }
        client.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult result) {
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) checkAvailable(call);
                else unavailable(call, result);
            }
            @Override public void onBillingServiceDisconnected() { /* reconnects on the next checkout */ }
        });
    }

    private void checkAvailable(PluginCall call) {
        client.isAlternativeBillingOnlyAvailableAsync(result -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) { unavailable(call, result); return; }
            getActivity().runOnUiThread(() -> client.showAlternativeBillingOnlyInformationDialog(getActivity(), dialog -> {
                int code = dialog.getResponseCode();
                if (code == BillingClient.BillingResponseCode.USER_CANCELED) { call.reject("canceled", "canceled"); return; }
                if (code != BillingClient.BillingResponseCode.OK) { unavailable(call, dialog); return; }
                client.createAlternativeBillingOnlyReportingDetailsAsync((tokenResult, reporting) -> {
                    if (tokenResult.getResponseCode() != BillingClient.BillingResponseCode.OK || reporting == null) { unavailable(call, tokenResult); return; }
                    JSObject out = new JSObject();
                    out.put("token", reporting.getExternalTransactionToken());
                    call.resolve(out);
                });
            }));
        });
    }

    private void unavailable(PluginCall call, BillingResult result) {
        JSObject out = new JSObject();
        out.put("unavailable", true);
        out.put("code", result.getResponseCode());
        call.resolve(out);
    }
}
