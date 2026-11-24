package com.sanwolf.ethekwinidrive;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.JavascriptInterface;
import android.os.Build;
import android.os.Bundle;
import android.graphics.Color;
import android.view.DisplayCutout;
import android.view.RoundedCorner;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
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
        // Draw into the notch / camera-hole areas too (the page keeps the HUD
        // clear of them with the safe-area insets sent below).
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        immersive();

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(13, 22, 32)); // no white flash / white strip
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
            @Override
            public void onPageFinished(WebView view, String url) { sendInsets(); }
        });
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            readInsets(insets);
            sendInsets();
            return v.onApplyWindowInsets(insets); // WebView still sets env(safe-area-inset-*) itself
        });
        setContentView(web);
        immersive();
        web.loadUrl(GAME);
        ui.postDelayed(watch, 2000);
    }

    // ---- Full screen on any phone ----
    // Sticky immersive: status bar and navigation bar hidden; a swipe from
    // the edge shows them for a moment, then they hide again by themselves.
    @SuppressWarnings("deprecation")
    private void immersive() {
        View decor = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = decor.getWindowInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    // Notch / camera hole / rounded-corner sizes in CSS px, passed to the page
    // as --nat-l/t/r/b/c (src/ui/fit.css uses them next to env(safe-area-inset-*),
    // because some WebViews report 0 for env()).
    private float insL, insT, insR, insB, corner;
    private void readInsets(WindowInsets in) {
        float d = getResources().getDisplayMetrics().density;
        insL = insT = insR = insB = corner = 0;
        if (Build.VERSION.SDK_INT >= 28) {
            DisplayCutout cut = in.getDisplayCutout();
            if (cut != null) {
                insL = cut.getSafeInsetLeft() / d; insT = cut.getSafeInsetTop() / d;
                insR = cut.getSafeInsetRight() / d; insB = cut.getSafeInsetBottom() / d;
            }
        }
        if (Build.VERSION.SDK_INT >= 31) {
            int r = 0;
            for (int pos : new int[] { RoundedCorner.POSITION_TOP_LEFT, RoundedCorner.POSITION_TOP_RIGHT,
                    RoundedCorner.POSITION_BOTTOM_LEFT, RoundedCorner.POSITION_BOTTOM_RIGHT }) {
                RoundedCorner rc = in.getRoundedCorner(pos);
                if (rc != null) r = Math.max(r, rc.getRadius());
            }
            // a box in the corner must stay this far in to clear the curve
            corner = (float) (r * (1 - Math.sqrt(0.5))) / d;
        }
    }
    private void sendInsets() {
        if (web == null) return;
        String js = String.format(java.util.Locale.US,
                "(function(s){s.setProperty('--nat-l','%.1fpx');s.setProperty('--nat-t','%.1fpx');"
                + "s.setProperty('--nat-r','%.1fpx');s.setProperty('--nat-b','%.1fpx');s.setProperty('--nat-c','%.1fpx');"
                + "window.dispatchEvent(new Event('resize'));})(document.documentElement.style)",
                insL, insT, insR, insB, corner);
        web.evaluateJavascript(js, null);
    }

    // Bars come back after a dialog, the keyboard or app switching: hide them again.
    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    // Phone locked / app switched: stop the game's timers and drawing too.
    @Override protected void onPause() { web.onPause(); web.pauseTimers(); visible = false; super.onPause(); }
    @Override protected void onResume() { super.onResume(); immersive(); web.resumeTimers(); web.onResume(); lastBeat = 0; visible = true; }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
