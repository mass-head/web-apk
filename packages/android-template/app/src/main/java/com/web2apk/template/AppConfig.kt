package com.web2apk.template

/**
 * Mutually exclusive content source mode for Web2APK
 */
enum class ContentSource {
    REMOTE,
    LOCAL
}

/**
 * Injected build configuration for the generated Android application
 */
object AppConfig {
    // Mode: REMOTE or LOCAL
    val contentSource: ContentSource = ContentSource.LOCAL

    // REMOTE mode target URL (Must be HTTPS)
    const val REMOTE_URL: String = "https://example.com"

    // LOCAL mode entrypoint asset path (inside assets/)
    const val LOCAL_ASSET_PATH: String = "web/index.html"

    // Virtual origin domain used by WebViewAssetLoader for safe local asset serving
    const val VIRTUAL_DOMAIN: String = "appassets.androidplatform.net"

    // UI Features
    const val ENABLE_PULL_TO_REFRESH: Boolean = true
    const val ENABLE_PROGRESS_BAR: Boolean = false

    // Timeout in milliseconds before displaying native timeout error
    const val PAGE_LOAD_TIMEOUT_MS: Long = 20000L

    // Optional CSS selector to hide a known website loading indicator on static sites
    // (Only injected when explicitly specified; never blindly deletes DOM elements)
    const val HIDE_CUSTOM_LOADING_SELECTOR: String = ""

    // Security & WebView Settings
    const val ENABLE_JAVASCRIPT: Boolean = true
    const val CUSTOM_USER_AGENT_SUFFIX: String = "Web2APK-Client/1.0"

    // Allowed external intent URI schemes (tel:, mailto:, sms:, geo:, whatsapp:)
    val ALLOWED_EXTERNAL_SCHEMES = setOf("tel", "mailto", "sms", "geo", "whatsapp")

    // Primary host for domain navigation restriction
    val ALLOWED_DOMAINS: List<String> = listOf()

    // Configurable SPA navigation fallback to index.html for client-side routing
    const val ENABLE_SPA_FALLBACK: Boolean = true

    // Hardware Features & Permissions (Disabled by default to avoid PHA flags)
    const val ENABLE_CAMERA: Boolean = false
    const val ENABLE_GEOLOCATION: Boolean = false
}
