package com.web2apk.template

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.webkit.SafeBrowsingResponse
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.InputStream

/**
 * Differentiated categories of web application load errors
 */
enum class AppErrorType {
    OFFLINE,
    SERVER_UNREACHABLE,
    HTTP_NOT_FOUND,
    HTTP_SERVER_ERROR,
    HTTP_GENERIC,
    SSL_ERROR,
    TIMEOUT,
    LOCAL_API_UNAVAILABLE
}

class AppWebViewClient(
    private val context: Context,
    private val networkMonitor: NetworkMonitor,
    private val callbacks: Callbacks
) : WebViewClient() {

    interface Callbacks {
        fun onPageLoadStarted(url: String?)
        fun onPageLoadFinished(url: String?, hasError: Boolean)
        fun onError(errorType: AppErrorType, failingUrl: String?, description: String?)
        fun onSslErrorEncountered(failingUrl: String?)
    }

    companion object {
        // Known static asset file extensions that should NEVER return index.html on 404
        private val STATIC_ASSET_EXTENSIONS = setOf(
            "js", "mjs", "cjs", "css", "map", "json",
            "png", "jpg", "jpeg", "gif", "svg", "webp", "ico",
            "woff", "woff2", "ttf", "eot", "otf",
            "wasm", "mp3", "mp4", "webm", "ogg", "wav", "pdf"
        )
    }

    // Flag to track whether the active page load experienced an error
    private var hasPageError = false

    // Secure local asset loader (used in LOCAL mode and for error assets)
    private val assetLoader = WebViewAssetLoader.Builder()
        .setDomain(AppConfig.VIRTUAL_DOMAIN)
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
        .build()

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest
    ): WebResourceResponse? {
        val uri = request.url ?: return super.shouldInterceptRequest(view, request)

        // Only intercept requests destined for our virtual domain in LOCAL mode
        if (AppConfig.contentSource == ContentSource.LOCAL &&
            uri.host.equals(AppConfig.VIRTUAL_DOMAIN, ignoreCase = true)
        ) {
            // 1. Try normal asset loading first
            val assetResponse = assetLoader.shouldInterceptRequest(uri)
            if (assetResponse != null) {
                return assetResponse
            }

            // 2. If the asset was not found, check if this is a static file request
            val path = uri.path ?: ""
            val extension = path.substringAfterLast('.', "").lowercase()

            if (STATIC_ASSET_EXTENSIONS.contains(extension)) {
                // Strict requirement: Never return index.html for missing JS, CSS, images, fonts, or WASM
                return WebResourceResponse(
                    "text/plain",
                    "UTF-8",
                    404,
                    "Not Found",
                    mapOf("Access-Control-Allow-Origin" to "*"),
                    ByteArrayInputStream("Asset not found: $path".toByteArray(Charsets.UTF_8))
                )
            }

            // 3. SPA Client-Side Route Fallback:
            // When path has no static extension and SPA fallback is enabled, serve index.html
            if (AppConfig.ENABLE_SPA_FALLBACK && path.startsWith("/assets/web/")) {
                try {
                    val indexStream: InputStream = context.assets.open(AppConfig.LOCAL_ASSET_PATH)
                    return WebResourceResponse(
                        "text/html",
                        "UTF-8",
                        200,
                        "OK",
                        mapOf(
                            "Access-Control-Allow-Origin" to "*",
                            "Cache-Control" to "no-cache"
                        ),
                        indexStream
                    )
                } catch (_: Exception) {
                    // Fall through if index.html cannot be opened
                }
            }
        }

        return super.shouldInterceptRequest(view, request)
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url ?: return false
        val scheme = uri.scheme?.lowercase() ?: return false

        // 1. Safe in-page scripting, anchors, blank pages, and data/blob targets
        if (scheme == "javascript" || scheme == "about" || scheme == "data" || scheme == "blob") {
            return false // Let WebView execute or handle internal scripts and data
        }

        // 2. Safe external communication schemes (tel:, mailto:, sms:, geo:, whatsapp:)
        if (AppConfig.ALLOWED_EXTERNAL_SCHEMES.contains(scheme)) {
            try {
                val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(intent)
            } catch (_: ActivityNotFoundException) {
                // Ignore if no app available to handle scheme
            }
            return true
        }

        // 3. Android intent:// scheme handling (with security sanitization)
        if (scheme == "intent") {
            try {
                val parsedIntent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                parsedIntent.component = null
                parsedIntent.selector = null
                parsedIntent.addCategory(Intent.CATEGORY_BROWSABLE)

                parsedIntent.flags = parsedIntent.flags and (
                    Intent.FLAG_GRANT_READ_URI_PERMISSION.inv() and
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION.inv() and
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION.inv() and
                    Intent.FLAG_GRANT_PREFIX_URI_PERMISSION.inv()
                )
                parsedIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

                if (context.packageManager.resolveActivity(parsedIntent, 0) != null) {
                    context.startActivity(parsedIntent)
                    return true
                }

                val fallbackUrl = parsedIntent.getStringExtra("browser_fallback_url")
                if (!fallbackUrl.isNullOrEmpty()) {
                    val fallbackUri = Uri.parse(fallbackUrl)
                    if (fallbackUri.scheme == "https") {
                        val baseHost = try { Uri.parse(AppConfig.REMOTE_URL).host } catch (_: Exception) { null }
                        if (isSameOrSubDomain(fallbackUri.host ?: "", baseHost)) {
                            view.loadUrl(fallbackUrl)
                        } else {
                            val extIntent = Intent(Intent.ACTION_VIEW, fallbackUri).apply {
                                flags = Intent.FLAG_ACTIVITY_NEW_TASK
                            }
                            context.startActivity(extIntent)
                        }
                    }
                    return true
                }
            } catch (_: Exception) {
                // Suppress malformed intent crash
            }
            return true
        }

        // 4. Local mode virtual domain and relative paths always stay inside WebView
        if (AppConfig.contentSource == ContentSource.LOCAL) {
            val host = uri.host
            if (host.isNullOrEmpty() || host.equals(AppConfig.VIRTUAL_DOMAIN, ignoreCase = true) || host == "localhost") {
                return false
            }
        }

        // 5. Domain navigation restrictions for REMOTE mode
        if (scheme == "https") {
            val currentHost = uri.host
            val targetHost = try {
                Uri.parse(AppConfig.REMOTE_URL).host
            } catch (_: Exception) {
                null
            }

            // Same domain, subdomains, and configured allowed domains stay within the app
            if (currentHost == null || isSameOrSubDomain(currentHost, targetHost) || isAllowedDomain(currentHost)) {
                return false
            }

            // External domains open in standard external browser
            try {
                val externalIntent = Intent(Intent.ACTION_VIEW, uri).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(externalIntent)
                return true
            } catch (_: Exception) {
                return false
            }
        } else if (scheme == "http") {
            // Unencrypted HTTP navigation must never stay inside the secure app WebView;
            // delegate to the external browser where user has standard browser protections
            try {
                val externalIntent = Intent(Intent.ACTION_VIEW, uri).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(externalIntent)
                return true
            } catch (_: Exception) {
                return false
            }
        }

        // 6. Block any unknown or unsupported schemes
        return true
    }

    private fun isSameOrSubDomain(currentHost: String, baseHost: String?): Boolean {
        if (baseHost == null) return false
        val c = currentHost.lowercase().removePrefix("www.")
        val b = baseHost.lowercase().removePrefix("www.")
        return c == b || c.endsWith(".$b")
    }

    private fun isAllowedDomain(host: String): Boolean {
        val h = host.lowercase().removePrefix("www.")
        return AppConfig.ALLOWED_DOMAINS.any { allowed ->
            val a = allowed.lowercase().removePrefix("www.")
            h == a || h.endsWith(".$a")
        }
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        hasPageError = false
        callbacks.onPageLoadStarted(url)
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        callbacks.onPageLoadFinished(url, hasPageError)

        // Inject App-like touch behavior to suppress long-press tooltips, image filenames, and tap delays
        val nativeUiJs = """
            (function() {
                if (document.getElementById('web2apk-native-styles')) return;
                var style = document.createElement('style');
                style.id = 'web2apk-native-styles';
                style.type = 'text/css';
                style.innerHTML = `
                    * {
                        -webkit-touch-callout: none !important;
                        -webkit-tap-highlight-color: transparent !important;
                    }
                    img, a, button, [role="button"], svg {
                        -webkit-user-select: none !important;
                        -webkit-user-drag: none !important;
                        user-select: none !important;
                        -webkit-touch-callout: none !important;
                    }
                    input, textarea, [contenteditable="true"] {
                        -webkit-user-select: text !important;
                        user-select: text !important;
                    }
                `;
                (document.head || document.documentElement).appendChild(style);

                // Prevent long-press context menu on images and links so web filename never pops up on hold
                window.addEventListener('contextmenu', function(e) {
                    if (e.target && (e.target.tagName === 'IMG' || e.target.tagName === 'A' || e.target.tagName === 'SVG' || e.target.closest('button') || e.target.closest('a'))) {
                        e.preventDefault();
                    }
                }, true);
            })();
        """.trimIndent()
        view?.evaluateJavascript(nativeUiJs, null)

        // If an explicit web loader selector is configured, safely disable it
        if (AppConfig.HIDE_CUSTOM_LOADING_SELECTOR.isNotBlank()) {
            val safeSelector = AppConfig.HIDE_CUSTOM_LOADING_SELECTOR.replace("'", "\\'")
            val hideLoaderJs = """
                (function() {
                    if (document.getElementById('web2apk-hide-custom-loader')) return;
                    var style = document.createElement('style');
                    style.id = 'web2apk-hide-custom-loader';
                    style.type = 'text/css';
                    style.textContent = '$safeSelector { display: none !important; opacity: 0 !important; visibility: hidden !important; }';
                    (document.head || document.documentElement).appendChild(style);
                })();
            """.trimIndent()
            view?.evaluateJavascript(hideLoaderJs, null)
        }
    }

    override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?
    ) {
        // Only main frame failures should trigger the app-level error screen
        if (request?.isForMainFrame == true) {
            hasPageError = true
            view?.stopLoading()

            val isOnline = networkMonitor.isOnline()
            val errorCode = error?.errorCode ?: ERROR_UNKNOWN

            val errorType = when {
                !isOnline -> AppErrorType.OFFLINE
                errorCode == ERROR_TIMEOUT -> AppErrorType.TIMEOUT
                errorCode == ERROR_HOST_LOOKUP || errorCode == ERROR_CONNECT -> AppErrorType.SERVER_UNREACHABLE
                else -> AppErrorType.SERVER_UNREACHABLE
            }

            val failingUrl = request.url?.toString()
            callbacks.onError(errorType, failingUrl, error?.description?.toString())
            return
        }
        super.onReceivedError(view, request, error)
    }

    override fun onReceivedHttpError(
        view: WebView?,
        request: WebResourceRequest?,
        errorResponse: WebResourceResponse?
    ) {
        // Main-frame HTTP errors (404, 500, etc.)
        if (request?.isForMainFrame == true) {
            val statusCode = errorResponse?.statusCode ?: 0
            if (statusCode >= 400) {
                hasPageError = true
                view?.stopLoading()

                val errorType = when (statusCode) {
                    404 -> AppErrorType.HTTP_NOT_FOUND
                    in 500..599 -> AppErrorType.HTTP_SERVER_ERROR
                    else -> AppErrorType.HTTP_GENERIC
                }

                val failingUrl = request.url?.toString()
                callbacks.onError(errorType, failingUrl, "HTTP $statusCode")
                return
            }
        }
        super.onReceivedHttpError(view, request, errorResponse)
    }

    override fun onReceivedSslError(
        view: WebView?,
        handler: SslErrorHandler?,
        error: SslError?
    ) {
        // SECURITY REQUIREMENT: Never auto-proceed on invalid SSL certificates!
        handler?.cancel()
        hasPageError = true
        view?.stopLoading()
        callbacks.onSslErrorEncountered(view?.url ?: error?.url)
    }

    override fun onSafeBrowsingHit(
        view: WebView?,
        request: WebResourceRequest?,
        threatType: Int,
        callback: SafeBrowsingResponse?
    ) {
        // SECURITY REQUIREMENT: Never bypass Safe Browsing warnings; automatically back to safety
        callback?.backToSafety(true)
    }
}
