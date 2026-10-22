package com.web2apk.template

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.Looper

/**
 * Monitors device network connectivity state using Android's ConnectivityManager APIs
 * with anti-flapping debounce protection.
 */
class NetworkMonitor(
    context: Context,
    private val onConnectivityChanged: (isConnected: Boolean) -> Unit
) {
    private val connectivityManager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    private val mainHandler = Handler(Looper.getMainLooper())
    private var lastReportedState: Boolean? = null
    private var pendingDebounceRunnable: Runnable? = null

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            scheduleStateCheck()
        }

        override fun onLost(network: Network) {
            scheduleStateCheck()
        }

        override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
            scheduleStateCheck()
        }
    }

    private fun scheduleStateCheck() {
        pendingDebounceRunnable?.let { mainHandler.removeCallbacks(it) }
        val check = Runnable {
            val online = isOnline()
            if (lastReportedState != online) {
                lastReportedState = online
                onConnectivityChanged(online)
            }
        }
        pendingDebounceRunnable = check
        mainHandler.postDelayed(check, 250)
    }

    fun isOnline(): Boolean {
        return try {
            val network = connectivityManager.activeNetwork ?: return false
            val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } catch (_: Exception) {
            false
        }
    }

    fun start() {
        try {
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            connectivityManager.registerNetworkCallback(request, networkCallback)
            lastReportedState = isOnline()
        } catch (_: Exception) {
            // Graceful fallback for restricted environments
        }
    }

    fun stop() {
        try {
            pendingDebounceRunnable?.let { mainHandler.removeCallbacks(it) }
            connectivityManager.unregisterNetworkCallback(networkCallback)
        } catch (_: Exception) {
        }
    }
}
