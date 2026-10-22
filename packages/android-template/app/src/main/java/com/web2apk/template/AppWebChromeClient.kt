package com.web2apk.template

import android.app.AlertDialog
import android.net.Uri
import android.os.Message
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts

class AppWebChromeClient(
    private val activity: ComponentActivity,
    private val permissionHandler: PermissionHandler,
    private val onProgressUpdate: (progress: Int) -> Unit
) : WebChromeClient() {

    interface PermissionHandler {
        fun requestMediaPermissions(
            resources: Array<String>,
            onResult: (grantedResources: Array<String>) -> Unit
        )

        fun requestGeolocationPermission(
            origin: String,
            onResult: (granted: Boolean) -> Unit
        )
    }

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermissionRequest: PermissionRequest? = null

    // Modern AndroidX ActivityResult launcher for web file uploads
    private val fileChooserLauncher: ActivityResultLauncher<String> =
        activity.registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
            filePathCallback?.onReceiveValue(uris.toTypedArray())
            filePathCallback = null
        }

    override fun onCreateWindow(
        view: WebView?,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message?
    ): Boolean {
        if (view == null || resultMsg == null) return false

        // Capture popup / window.open targets with domain verification
        val newWebView = WebView(view.context)
        newWebView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView?, request: WebResourceRequest?): Boolean {
                val targetUri = request?.url ?: return true
                val targetUrl = targetUri.toString()
                if (targetUrl.isNotEmpty()) {
                    if (isOriginApproved(targetUri)) {
                        view.loadUrl(targetUrl)
                    } else {
                        // Open external untrusted origins in external system browser
                        try {
                            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, targetUri).apply {
                                flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK
                            }
                            activity.startActivity(intent)
                        } catch (_: Exception) {}
                    }
                }
                return true
            }
        }

        val transport = resultMsg.obj as? WebView.WebViewTransport
        if (transport != null) {
            transport.webView = newWebView
            resultMsg.sendToTarget()
            return true
        }
        return false
    }

    override fun onProgressChanged(view: WebView?, newProgress: Int) {
        super.onProgressChanged(view, newProgress)
        onProgressUpdate(newProgress)
    }

    override fun onShowFileChooser(
        webView: WebView?,
        filePathCallback: ValueCallback<Array<Uri>>?,
        fileChooserParams: FileChooserParams?
    ): Boolean {
        // Cancel any pending file chooser callback
        this.filePathCallback?.onReceiveValue(null)
        this.filePathCallback = filePathCallback

        try {
            val acceptTypes = fileChooserParams?.acceptTypes?.firstOrNull()?.takeIf { it.isNotBlank() } ?: "*/*"
            fileChooserLauncher.launch(acceptTypes)
            return true
        } catch (_: Exception) {
            this.filePathCallback?.onReceiveValue(null)
            this.filePathCallback = null
            return false
        }
    }

    override fun onPermissionRequest(request: PermissionRequest?) {
        if (request == null) return

        // If camera is disabled in AppConfig, deny immediately
        if (!AppConfig.ENABLE_CAMERA) {
            request.deny()
            return
        }

        val requestOrigin = request.origin ?: run {
            request.deny()
            return
        }

        // 1. Strict Origin Validation: Verify the origin is approved and using HTTPS
        if (!isOriginApproved(requestOrigin)) {
            request.deny()
            return
        }

        // 2. Resource Validation: Allow only camera video capture when explicitly enabled
        val requestedResources = request.resources ?: run {
            request.deny()
            return
        }

        val supportedResources = requestedResources.filter { res ->
            res == PermissionRequest.RESOURCE_VIDEO_CAPTURE ||
            res == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID
        }.toTypedArray()

        if (supportedResources.isEmpty()) {
            request.deny()
            return
        }

        // 3. Delegate to Android runtime permission flow
        pendingPermissionRequest = request
        permissionHandler.requestMediaPermissions(supportedResources) { grantedResources ->
            if (pendingPermissionRequest == request) {
                if (grantedResources.isNotEmpty()) {
                    request.grant(grantedResources)
                } else {
                    request.deny()
                }
                pendingPermissionRequest = null
            }
        }
    }

    override fun onPermissionRequestCanceled(request: PermissionRequest?) {
        if (pendingPermissionRequest == request) {
            pendingPermissionRequest = null
        }
        super.onPermissionRequestCanceled(request)
    }

    override fun onGeolocationPermissionsShowPrompt(
        origin: String?,
        callback: GeolocationPermissions.Callback?
    ) {
        if (!AppConfig.ENABLE_GEOLOCATION || origin == null || callback == null) {
            callback?.invoke(origin, false, false)
            return
        }

        val uri = try {
            Uri.parse(origin)
        } catch (_: Exception) {
            null
        }

        if (uri == null || !isOriginApproved(uri)) {
            // Reject untrusted origins
            callback.invoke(origin, false, false)
            return
        }

        // Delegate to Android runtime location permission flow
        permissionHandler.requestGeolocationPermission(origin) { granted ->
            // Do not permanently retain grant to protect user privacy across sessions
            callback.invoke(origin, granted, false)
        }
    }

    override fun onGeolocationPermissionsHidePrompt() {
        super.onGeolocationPermissionsHidePrompt()
    }

    private fun isOriginApproved(uri: Uri): Boolean {
        // Enforce HTTPS / Secure Context
        val scheme = uri.scheme?.lowercase() ?: return false
        if (scheme != "https") {
            return false
        }

        val host = uri.host?.lowercase() ?: return false

        // LOCAL mode: Only the secure virtual domain is trusted
        if (AppConfig.contentSource == ContentSource.LOCAL) {
            return host == AppConfig.VIRTUAL_DOMAIN.lowercase()
        }

        // REMOTE mode: Compare against configured start URL host and approved domains
        val remoteHost = try {
            Uri.parse(AppConfig.REMOTE_URL).host?.lowercase()
        } catch (_: Exception) {
            null
        } ?: return false

        val h = host.removePrefix("www.")
        val r = remoteHost.removePrefix("www.")

        if (h == r || h.endsWith(".$r")) {
            return true
        }

        return AppConfig.ALLOWED_DOMAINS.any { allowed ->
            val a = allowed.lowercase().removePrefix("www.")
            h == a || h.endsWith(".$a")
        }
    }

    override fun onJsAlert(
        view: WebView?,
        url: String?,
        message: String?,
        result: JsResult?
    ): Boolean {
        AlertDialog.Builder(activity)
            .setMessage(message)
            .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
            .setOnCancelListener { result?.cancel() }
            .show()
        return true
    }

    override fun onJsConfirm(
        view: WebView?,
        url: String?,
        message: String?,
        result: JsResult?
    ): Boolean {
        AlertDialog.Builder(activity)
            .setMessage(message)
            .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
            .setNegativeButton(android.R.string.cancel) { _, _ -> result?.cancel() }
            .setOnCancelListener { result?.cancel() }
            .show()
        return true
    }

    override fun onJsPrompt(
        view: WebView?,
        url: String?,
        message: String?,
        defaultValue: String?,
        result: JsPromptResult?
    ): Boolean {
        val input = EditText(activity).apply {
            setText(defaultValue)
        }
        AlertDialog.Builder(activity)
            .setMessage(message)
            .setView(input)
            .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm(input.text.toString()) }
            .setNegativeButton(android.R.string.cancel) { _, _ -> result?.cancel() }
            .setOnCancelListener { result?.cancel() }
            .show()
        return true
    }

    fun cleanup() {
        pendingPermissionRequest?.deny()
        pendingPermissionRequest = null
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
    }
}
