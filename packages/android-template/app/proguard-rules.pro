# Keep WebView JavaScript interfaces
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep WebKit classes
-keep class androidx.webkit.** { *; }

# Keep Web2APK template classes and configuration
-keep class com.web2apk.template.** { *; }
-keepclassmembers class com.web2apk.template.** { *; }

