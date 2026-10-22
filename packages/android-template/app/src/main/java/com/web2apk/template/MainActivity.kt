package com.web2apk.template

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.ColorUtils
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.button.MaterialButton

class MainActivity : AppCompatActivity(), AppWebChromeClient.PermissionHandler {

    companion object {
        private const val KEY_SAVED_URL = "WEB2APK_CURRENT_URL"
    }

    private lateinit var webView: WebView
    private lateinit var swipeRefreshLayout: SwipeRefreshLayout
    private lateinit var errorContainer: View
    private lateinit var errorIcon: ImageView
    private lateinit var connectivityStatusBadge: TextView
    private lateinit var errorTitle: TextView
    private lateinit var errorDescription: TextView
    private lateinit var btnRetry: MaterialButton
    private lateinit var btnGoBack: MaterialButton

    // Initial Launch Native Loading Overlay
    private lateinit var splashContainer: FrameLayout
    private lateinit var splashProgressBar: ProgressBar
    private lateinit var splashLoadingText: TextView
    private lateinit var splashBtnRetry: MaterialButton

    // In-App Navigation Loading Indicator (Anti-flicker subtle loader)
    private lateinit var navLoadingContainer: FrameLayout
    private lateinit var navLoadingCard: View
    private lateinit var navLoadingText: TextView

    private lateinit var networkMonitor: NetworkMonitor
    private var appWebChromeClient: AppWebChromeClient? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private var backPressedTime: Long = 0
    private var isInitialPageLoaded: Boolean = false
    private var activeErrorType: AppErrorType? = null
    private var lastFailingUrl: String? = null
    private var isRetryInProgress: Boolean = false

    // Anti-flicker delay runnable for in-app navigation loader
    private val showNavLoaderRunnable = Runnable {
        if (!isInitialPageLoaded) return@Runnable
        navLoadingContainer.alpha = 0f
        navLoadingContainer.visibility = View.VISIBLE
        navLoadingContainer.animate()
            .alpha(1f)
            .setDuration(200)
            .start()
    }

    // Page timeout safeguard runnable
    private val pageTimeoutRunnable = Runnable {
        if (webView.progress < 100) {
            webView.stopLoading()
            handleLoadError(
                AppErrorType.TIMEOUT,
                webView.url ?: lastFailingUrl,
                getString(R.string.error_timeout_desc)
            )
        }
    }

    // Pending callbacks for runtime permissions
    private var pendingMediaCallback: ((Array<String>) -> Unit)? = null
    private var pendingLocationCallback: ((Boolean) -> Unit)? = null

    // ActivityResult launchers for runtime permissions
    private val mediaPermissionLauncher: ActivityResultLauncher<Array<String>> =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
            val grantedResources = mutableListOf<String>()
            val cameraGranted = permissions[Manifest.permission.CAMERA] == true

            if (cameraGranted) {
                grantedResources.add(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
            }

            val cameraPermanentlyDenied = !cameraGranted && permissions.containsKey(Manifest.permission.CAMERA) &&
                !ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.CAMERA)

            if (cameraPermanentlyDenied) {
                showSettingsDialog(getString(R.string.permission_denied_settings_msg))
            }

            pendingMediaCallback?.invoke(grantedResources.toTypedArray())
            pendingMediaCallback = null
        }

    private val locationPermissionLauncher: ActivityResultLauncher<Array<String>> =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
            val fineGranted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true
            val coarseGranted = permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
            val isGranted = fineGranted || coarseGranted

            if (!isGranted) {
                val permanentlyDenied = !ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.ACCESS_FINE_LOCATION)
                if (permanentlyDenied) {
                    showSettingsDialog(getString(R.string.permission_denied_settings_msg))
                }
            }

            pendingLocationCallback?.invoke(isGranted)
            pendingLocationCallback = null
        }

    private val entryUrl: String
        get() = when (AppConfig.contentSource) {
            ContentSource.REMOTE -> AppConfig.REMOTE_URL
            ContentSource.LOCAL -> "https://${AppConfig.VIRTUAL_DOMAIN}/assets/${AppConfig.LOCAL_ASSET_PATH}"
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        // Transition from cold-start splash theme to normal app theme
        setTheme(R.style.Theme_Web2APK)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Configure edge-to-edge system bars and adaptive icon styling
        setupSystemBars()

        // Initialize Google WebView Safe Browsing
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            WebView.startSafeBrowsing(applicationContext) { _ -> }
        }

        // Bind UI Views
        webView = findViewById(R.id.webView)
        swipeRefreshLayout = findViewById(R.id.swipeRefreshLayout)

        errorContainer = findViewById(R.id.errorContainer)
        errorIcon = findViewById(R.id.errorIcon)
        connectivityStatusBadge = findViewById(R.id.connectivityStatusBadge)
        errorTitle = findViewById(R.id.errorTitle)
        errorDescription = findViewById(R.id.errorDescription)
        btnRetry = findViewById(R.id.btnRetry)
        btnGoBack = findViewById(R.id.btnGoBack)

        splashContainer = findViewById(R.id.splashContainer)
        splashProgressBar = findViewById(R.id.splashProgressBar)
        splashLoadingText = findViewById(R.id.splashLoadingText)
        splashBtnRetry = findViewById(R.id.splashBtnRetry)

        navLoadingContainer = findViewById(R.id.navLoadingContainer)
        navLoadingCard = findViewById(R.id.navLoadingCard)
        navLoadingText = findViewById(R.id.navLoadingText)

        // Initialize Network Monitor with debounced online detection
        networkMonitor = NetworkMonitor(this) { isConnected ->
            runOnUiThread {
                if (errorContainer.visibility == View.VISIBLE) {
                    if (activeErrorType == AppErrorType.OFFLINE || activeErrorType == AppErrorType.LOCAL_API_UNAVAILABLE) {
                        updateConnectivityBadge(isConnected)
                    }
                    if (isConnected && !isRetryInProgress) {
                        handleRetry()
                    }
                }
            }
        }

        // Configure App-like Back Pressed Navigation
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // 1. If error container is showing and history exists, go back to previous working page
                if (errorContainer.visibility == View.VISIBLE && webView.canGoBack()) {
                    hideError()
                    webView.goBack()
                    return
                }

                // 2. Normal in-app web navigation back-stack
                if (webView.canGoBack()) {
                    webView.goBack()
                    return
                }

                // 3. Double-tap back within 2 seconds to exit app
                if (backPressedTime + 2000 > System.currentTimeMillis()) {
                    finish()
                } else {
                    Toast.makeText(
                        this@MainActivity,
                        getString(R.string.press_back_again_to_exit),
                        Toast.LENGTH_SHORT
                    ).show()
                    backPressedTime = System.currentTimeMillis()
                }
            }
        })

        // Configure Pull to Refresh
        swipeRefreshLayout.isEnabled = AppConfig.ENABLE_PULL_TO_REFRESH
        swipeRefreshLayout.setOnChildScrollUpCallback { _, _ ->
            webView.canScrollVertically(-1) || webView.scrollY > 0
        }
        swipeRefreshLayout.setOnRefreshListener {
            if (AppConfig.contentSource == ContentSource.REMOTE && !networkMonitor.isOnline()) {
                swipeRefreshLayout.isRefreshing = false
                handleLoadError(
                    AppErrorType.OFFLINE,
                    webView.url ?: lastFailingUrl,
                    getString(R.string.message_offline)
                )
            } else {
                webView.reload()
            }
        }

        // Long-click suppression to prevent context menus or web filename tooltips on images/links
        webView.isLongClickable = false
        webView.isHapticFeedbackEnabled = false
        webView.setOnLongClickListener { true }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.tooltipText = null
        }

        // Download handling
        setupDownloadListener()

        // Retry and Back actions in error layout
        btnRetry.setOnClickListener {
            handleRetry()
        }
        btnGoBack.setOnClickListener {
            if (webView.canGoBack()) {
                hideError()
                webView.goBack()
            }
        }

        // Retry action in splash layout
        splashBtnRetry.setOnClickListener {
            splashBtnRetry.visibility = View.GONE
            splashProgressBar.visibility = View.VISIBLE
            splashLoadingText.visibility = View.VISIBLE
            handleRetry()
        }

        // Configure Secure & App-Optimized WebView Settings
        configureWebViewSettings()

        // Set WebChromeClient
        val chromeClient = AppWebChromeClient(this, this) { _ ->
            // Progress updates are monitored without browser top progress bars
        }
        appWebChromeClient = chromeClient
        webView.webChromeClient = chromeClient

        // Set WebViewClient with dedicated error classification & page loader control
        webView.webViewClient = AppWebViewClient(this, networkMonitor, object : AppWebViewClient.Callbacks {
            override fun onPageLoadStarted(url: String?) {
                lastFailingUrl = url ?: lastFailingUrl
                mainHandler.removeCallbacks(pageTimeoutRunnable)
                mainHandler.postDelayed(pageTimeoutRunnable, AppConfig.PAGE_LOAD_TIMEOUT_MS)

                if (isInitialPageLoaded) {
                    mainHandler.removeCallbacks(showNavLoaderRunnable)
                    mainHandler.postDelayed(showNavLoaderRunnable, 300)
                }
            }

            override fun onPageLoadFinished(url: String?, hasError: Boolean) {
                mainHandler.removeCallbacks(pageTimeoutRunnable)
                mainHandler.removeCallbacks(showNavLoaderRunnable)
                hideNavLoader()
                swipeRefreshLayout.isRefreshing = false

                if (!hasError) {
                    if (!isInitialPageLoaded) {
                        isInitialPageLoaded = true
                        dismissSplashScreen()
                    }
                    hideError()
                    isRetryInProgress = false
                }
            }

            override fun onError(errorType: AppErrorType, failingUrl: String?, description: String?) {
                handleLoadError(errorType, failingUrl, description)
            }

            override fun onSslErrorEncountered(failingUrl: String?) {
                handleLoadError(
                    AppErrorType.SSL_ERROR,
                    failingUrl,
                    getString(R.string.ssl_error_desc)
                )
            }
        })

        // Initial Load or State Restoration
        if (savedInstanceState != null) {
            val restored = webView.restoreState(savedInstanceState)
            if (restored == null || webView.url.isNullOrBlank()) {
                val savedUrl = savedInstanceState.getString(KEY_SAVED_URL)
                val target = if (!savedUrl.isNullOrBlank()) savedUrl else entryUrl
                if (AppConfig.contentSource == ContentSource.REMOTE && !networkMonitor.isOnline()) {
                    handleLoadError(AppErrorType.OFFLINE, target, getString(R.string.message_offline))
                } else {
                    webView.loadUrl(target)
                }
            }
        } else {
            // Cold start navigation
            if (AppConfig.contentSource == ContentSource.REMOTE && !networkMonitor.isOnline()) {
                handleLoadError(
                    AppErrorType.OFFLINE,
                    entryUrl,
                    getString(R.string.message_offline)
                )
            } else {
                webView.loadUrl(entryUrl)
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
        outState.putString(KEY_SAVED_URL, webView.url ?: lastFailingUrl)
    }

    private fun setupSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, true)
        val windowInsetsController = WindowInsetsControllerCompat(window, window.decorView)

        val bgColor = ContextCompat.getColor(this, R.color.backgroundColor)
        val isLightBg = ColorUtils.calculateLuminance(bgColor) > 0.5

        windowInsetsController.isAppearanceLightStatusBars = isLightBg
        windowInsetsController.isAppearanceLightNavigationBars = isLightBg

        window.statusBarColor = ContextCompat.getColor(this, R.color.statusBarColor)
        window.navigationBarColor = bgColor
    }

    private fun dismissSplashScreen() {
        if (splashContainer.visibility == View.VISIBLE) {
            splashContainer.animate()
                .alpha(0f)
                .setDuration(280)
                .withEndAction {
                    splashContainer.visibility = View.GONE
                    splashContainer.alpha = 1f
                }
                .start()
        }
    }

    private fun hideNavLoader() {
        if (navLoadingContainer.visibility == View.VISIBLE) {
            navLoadingContainer.animate()
                .alpha(0f)
                .setDuration(200)
                .withEndAction {
                    navLoadingContainer.visibility = View.GONE
                }
                .start()
        } else {
            navLoadingContainer.visibility = View.GONE
        }
    }

    private fun updateConnectivityBadge(isOnline: Boolean) {
        connectivityStatusBadge.visibility = View.VISIBLE
        if (isOnline) {
            connectivityStatusBadge.text = getString(R.string.status_back_online)
            connectivityStatusBadge.setTextColor(ContextCompat.getColor(this, R.color.accentColor))
        } else {
            connectivityStatusBadge.text = getString(R.string.status_offline)
            connectivityStatusBadge.setTextColor(ContextCompat.getColor(this, R.color.textColorSecondary))
        }
    }

    private fun handleLoadError(errorType: AppErrorType, failingUrl: String?, description: String?) {
        runOnUiThread {
            mainHandler.removeCallbacks(pageTimeoutRunnable)
            mainHandler.removeCallbacks(showNavLoaderRunnable)
            hideNavLoader()
            swipeRefreshLayout.isRefreshing = false
            webView.stopLoading()

            activeErrorType = errorType
            lastFailingUrl = failingUrl ?: webView.url ?: lastFailingUrl

            // Hide WebView so Chromium's native browser error page is never revealed
            webView.visibility = View.GONE

            // Dismiss initial splash overlay so full native error UI is visible
            dismissSplashScreen()

            // Update UI components according to error category
            when (errorType) {
                AppErrorType.OFFLINE -> {
                    errorIcon.setImageResource(R.drawable.ic_offline)
                    errorTitle.text = getString(R.string.heading_offline)
                    errorDescription.text = getString(R.string.message_offline)
                    updateConnectivityBadge(networkMonitor.isOnline())
                    btnRetry.visibility = View.VISIBLE
                }
                AppErrorType.SERVER_UNREACHABLE -> {
                    errorIcon.setImageResource(R.drawable.ic_server_error)
                    errorTitle.text = getString(R.string.error_server_title)
                    errorDescription.text = getString(R.string.error_server_desc)
                    connectivityStatusBadge.visibility = View.GONE
                    btnRetry.visibility = View.VISIBLE
                }
                AppErrorType.HTTP_NOT_FOUND -> {
                    errorIcon.setImageResource(R.drawable.ic_page_error)
                    errorTitle.text = getString(R.string.error_not_found_title)
                    errorDescription.text = getString(R.string.error_not_found_desc)
                    connectivityStatusBadge.visibility = View.GONE
                    btnRetry.visibility = View.VISIBLE
                }
                AppErrorType.HTTP_SERVER_ERROR, AppErrorType.HTTP_GENERIC -> {
                    errorIcon.setImageResource(R.drawable.ic_server_error)
                    errorTitle.text = getString(R.string.error_server_error_title)
                    errorDescription.text = if (!description.isNullOrBlank() && description.startsWith("HTTP")) {
                        "${getString(R.string.error_server_error_desc)}\n($description)"
                    } else {
                        getString(R.string.error_server_error_desc)
                    }
                    connectivityStatusBadge.visibility = View.GONE
                    btnRetry.visibility = View.VISIBLE
                }
                AppErrorType.SSL_ERROR -> {
                    errorIcon.setImageResource(R.drawable.ic_security_warning)
                    errorTitle.text = getString(R.string.ssl_error_title)
                    errorDescription.text = getString(R.string.ssl_error_desc)
                    connectivityStatusBadge.visibility = View.GONE
                    btnRetry.visibility = View.VISIBLE
                }
                AppErrorType.TIMEOUT -> {
                    errorIcon.setImageResource(R.drawable.ic_timeout)
                    errorTitle.text = getString(R.string.error_timeout_title)
                    errorDescription.text = getString(R.string.error_timeout_desc)
                    connectivityStatusBadge.visibility = View.GONE
                    btnRetry.visibility = View.VISIBLE
                }
                AppErrorType.LOCAL_API_UNAVAILABLE -> {
                    errorIcon.setImageResource(R.drawable.ic_offline)
                    errorTitle.text = getString(R.string.error_local_api_title)
                    errorDescription.text = getString(R.string.error_local_api_desc)
                    updateConnectivityBadge(networkMonitor.isOnline())
                    btnRetry.visibility = View.VISIBLE
                }
            }

            // Provide 'Go Back' option if the in-app history has previous pages
            if (webView.canGoBack()) {
                btnGoBack.visibility = View.VISIBLE
            } else {
                btnGoBack.visibility = View.GONE
            }

            errorContainer.visibility = View.VISIBLE
            isRetryInProgress = false
        }
    }

    private fun handleRetry() {
        if (isRetryInProgress) return
        isRetryInProgress = true

        // In REMOTE mode, verify connectivity before issuing a new web load
        if (AppConfig.contentSource == ContentSource.REMOTE && !networkMonitor.isOnline()) {
            updateConnectivityBadge(false)
            Toast.makeText(this, getString(R.string.message_offline), Toast.LENGTH_SHORT).show()
            isRetryInProgress = false
            return
        }

        hideError()

        // Preserve current failed route when retrying instead of resetting to start URL
        val targetToLoad = lastFailingUrl.takeIf { !it.isNullOrBlank() && it != "about:blank" && !it.startsWith("chrome-error://") }
            ?: webView.url.takeIf { !it.isNullOrBlank() && it != "about:blank" && !it.startsWith("chrome-error://") }
            ?: entryUrl

        webView.loadUrl(targetToLoad)
    }

    private fun hideError() {
        runOnUiThread {
            errorContainer.visibility = View.GONE
            webView.visibility = View.VISIBLE
        }
    }

    private fun setupDownloadListener() {
        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            try {
                val filename = URLUtil.guessFileName(url, contentDisposition, mimeType)
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimeType)
                    addRequestHeader("User-Agent", userAgent)
                    setDescription(getString(R.string.downloading_file))
                    setTitle(filename)
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
                }
                val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(request)
                Toast.makeText(this, getString(R.string.download_started), Toast.LENGTH_SHORT).show()
            } catch (_: Exception) {
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    startActivity(intent)
                } catch (_: Exception) {
                    Toast.makeText(this, getString(R.string.download_failed), Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebViewSettings() {
        val settings = webView.settings

        // JavaScript Execution
        settings.javaScriptEnabled = AppConfig.ENABLE_JAVASCRIPT

        // Storage, Cache, and Cookies
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
            flush()
        }

        // Support window.open and button popup dialogs
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.setSupportMultipleWindows(true)

        // Media Playback
        settings.mediaPlaybackRequiresUserGesture = false

        // Strict Local File Access Security
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false

        // Mixed Content Security: Strictly block insecure HTTP content on HTTPS
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

        // Viewport & Mobile Responsive Layout
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.textZoom = 100

        // Smooth Scrolling
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.isVerticalScrollBarEnabled = true
        webView.isHorizontalScrollBarEnabled = false
        webView.isScrollbarFadingEnabled = true
        webView.overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
        ViewCompat.setNestedScrollingEnabled(webView, true)

        // Custom User Agent
        settings.userAgentString = "${settings.userAgentString} ${AppConfig.CUSTOM_USER_AGENT_SUFFIX}"
    }

    // =========================================================================
    // PermissionHandler Implementation (WebChromeClient -> Android Runtime)
    // =========================================================================

    override fun requestMediaPermissions(
        resources: Array<String>,
        onResult: (grantedResources: Array<String>) -> Unit
    ) {
        if (!AppConfig.ENABLE_CAMERA || !resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
            onResult(emptyArray())
            return
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            onResult(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
            return
        }

        pendingMediaCallback = onResult

        if (ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.CAMERA)) {
            AlertDialog.Builder(this)
                .setMessage(getString(R.string.permission_camera_rationale))
                .setPositiveButton(getString(R.string.btn_allow)) { _, _ ->
                    mediaPermissionLauncher.launch(arrayOf(Manifest.permission.CAMERA))
                }
                .setNegativeButton(getString(R.string.btn_cancel)) { _, _ ->
                    onResult(emptyArray())
                    pendingMediaCallback = null
                }
                .setOnCancelListener {
                    onResult(emptyArray())
                    pendingMediaCallback = null
                }
                .show()
        } else {
            mediaPermissionLauncher.launch(arrayOf(Manifest.permission.CAMERA))
        }
    }

    override fun requestGeolocationPermission(
        origin: String,
        onResult: (granted: Boolean) -> Unit
    ) {
        if (!AppConfig.ENABLE_GEOLOCATION) {
            onResult(false)
            return
        }

        val hasFine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

        if (hasFine || hasCoarse) {
            onResult(true)
            return
        }

        pendingLocationCallback = onResult

        if (ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.ACCESS_FINE_LOCATION)) {
            AlertDialog.Builder(this)
                .setMessage(getString(R.string.permission_location_rationale))
                .setPositiveButton(getString(R.string.btn_allow)) { _, _ ->
                    locationPermissionLauncher.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        )
                    )
                }
                .setNegativeButton(getString(R.string.btn_cancel)) { _, _ ->
                    onResult(false)
                    pendingLocationCallback = null
                }
                .setOnCancelListener {
                    onResult(false)
                    pendingLocationCallback = null
                }
                .show()
        } else {
            locationPermissionLauncher.launch(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                )
            )
        }
    }

    private fun showSettingsDialog(message: String) {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.permission_denied_settings_title))
            .setMessage(message)
            .setPositiveButton(getString(R.string.btn_open_settings)) { _, _ ->
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", packageName, null)
                }
                startActivity(intent)
            }
            .setNegativeButton(getString(R.string.btn_cancel), null)
            .show()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        networkMonitor.start()
        CookieManager.getInstance().flush()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
        networkMonitor.stop()
        mainHandler.removeCallbacks(pageTimeoutRunnable)
        mainHandler.removeCallbacks(showNavLoaderRunnable)
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(pageTimeoutRunnable)
        mainHandler.removeCallbacks(showNavLoaderRunnable)
        appWebChromeClient?.cleanup()
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }
}
