package com.sanwolf.ethekwinidrive;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.JavascriptInterface;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;

/** Shows the web game from the APK's own files, served over a safe local https address. */
public class MainActivity extends Activity {
    private WebView web;
    private static final String GAME = "https://appassets.androidplatform.net/assets/index.html";
    // Freeze watchdog: the game pings every second. If the pings stop for
    // 12 s while the app is open, offer Wait / Restart in safe mode instead
    // of leaving a frozen screen.
    private volatile long lastBeat = 0;
    private boolean visible = false;
    private AlertDialog frozen;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable watch = new Runnable() {
        @Override public void run() {
            if (visible && lastBeat > 0 && SystemClock.elapsedRealtime() - lastBeat > 12000 && (frozen == null || !frozen.isShowing())) {
                frozen = new AlertDialog.Builder(MainActivity.this)
                        .setTitle("IZK isn't responding")
                        .setMessage("The game has frozen. Wait a bit longer, or restart in safe mode (lighter graphics, you keep your save).")
                        .setPositiveButton("Wait", (d, w) -> lastBeat = SystemClock.elapsedRealtime())
                        .setNegativeButton("Restart (safe)", (d, w) -> { lastBeat = 0; web.loadUrl(GAME + "?safe=1"); })
                        .setCancelable(false)
                        .show();
            }
            ui.postDelayed(this, 2000);
        }
    };

    public class Beat {
        @JavascriptInterface public void ping() {
            lastBeat = SystemClock.elapsedRealtime();
            ui.post(() -> { if (frozen != null && frozen.isShowing()) frozen.dismiss(); });
        }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Beat(), "IZKNative");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
        });
        setContentView(web);
        web.loadUrl(GAME);
        ui.postDelayed(watch, 2000);
    }

    // Phone locked / app switched: stop the game's timers and drawing too.
    @Override protected void onPause() { web.onPause(); web.pauseTimers(); visible = false; super.onPause(); }
    @Override protected void onResume() { super.onResume(); web.resumeTimers(); web.onResume(); lastBeat = 0; visible = true; }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
