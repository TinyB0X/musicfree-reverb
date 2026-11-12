package `fun`.upup.musicfree.reverb

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.media.AudioManager
import android.media.audiofx.AudioEffect
import android.media.audiofx.EnvironmentalReverb
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap

/**
 * 混响（Reverb）原生模块。
 *
 * 原理：
 *  1. 通过 ServiceConnection 绑定 react-native-track-player 的 MusicService，
 *     拿到 MusicService 实例后反射出内部的 QueuedAudioPlayer（kotlin-audio），
 *     再通过公开的 getExoPlayer() 拿到 ExoPlayer。
 *  2. 读取 / 设置 ExoPlayer 的 audioSessionId，用 EnvironmentalReverb
 *     把混响效果挂到本应用自己的音频会话上（不需要系统权限，也不影响其它 App）。
 *  3. 播放尚未开始、session 还没生成时，会定时重试挂载。
 */
class ReverbModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "ReverbModule"
        /** react-native-track-player 的播放服务 */
        private const val MUSIC_SERVICE_CLASS =
            "com.doublesymmetry.trackplayer.service.MusicService"
        /** 重试间隔 */
        private const val RETRY_INTERVAL_MS = 500L
        /** 最多重试次数（约 20 秒） */
        private const val MAX_RETRY_COUNT = 40
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    /** 播放服务 */
    private var musicService: Any? = null
    private var binding = false
    private var bindCallbacks: MutableList<() -> Unit> = mutableListOf()

    /** 当前挂载的混响实例 */
    private var effect: EnvironmentalReverb? = null
    private var attachedSessionId = 0

    /** 目标状态 */
    private var targetEnabled = false
    private var targetParams: ReverbParams? = null

    private var retryCount = 0

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            binding = false
            musicService = try {
                service?.javaClass?.getMethod("getService")?.invoke(service)
            } catch (t: Throwable) {
                Log.w(TAG, "获取 MusicService 失败", t)
                null
            }

            val callbacks = bindCallbacks.toList()
            bindCallbacks.clear()
            callbacks.forEach { callback ->
                try {
                    callback()
                } catch (t: Throwable) {
                    Log.w(TAG, "服务连接回调执行失败", t)
                }
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            musicService = null
            releaseEffect()
        }
    }

    override fun getName() = "Reverb"

    /**
     * 应用混响参数
     * @param enabled 是否开启
     * @param params 混响参数
     */
    @ReactMethod
    fun update(enabled: Boolean, params: ReadableMap?, promise: Promise) {
        runOnMain {
            try {
                targetEnabled = enabled
                targetParams = params?.let { parseParams(it) }
                retryCount = 0

                if (enabled) {
                    applyInternal()
                } else {
                    releaseEffect()
                }
                promise.resolve(buildStatus())
            } catch (t: Throwable) {
                Log.w(TAG, "更新混响参数失败", t)
                promise.reject("reverb_update_failed", t)
            }
        }
    }

    /** 关闭混响 */
    @ReactMethod
    fun disable(promise: Promise) {
        runOnMain {
            try {
                targetEnabled = false
                releaseEffect()
                promise.resolve(buildStatus())
            } catch (t: Throwable) {
                promise.reject("reverb_disable_failed", t)
            }
        }
    }

    /** 当前状态（不会阻塞等待服务绑定，绑定在后台进行） */
    @ReactMethod
    fun getStatus(promise: Promise) {
        runOnMain {
            try {
                ensureBound { }
                promise.resolve(buildStatus())
            } catch (t: Throwable) {
                promise.reject("reverb_status_failed", t)
            }
        }
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            mainHandler.post(block)
        }
    }

    private fun buildStatus(): WritableMap {
        val status = Arguments.createMap()
        status.putBoolean("supported", effect != null)
        status.putBoolean("enabled", targetEnabled && effect != null)
        status.putInt("sessionId", attachedSessionId)
        return status
    }

    // ------------------------------------------------------------------
    // 挂载逻辑
    // ------------------------------------------------------------------

    private fun applyInternal() {
        if (!targetEnabled) {
            return
        }
        val params = targetParams ?: return

        ensureBound {
            tryApply(params)
        }
    }

    private fun ensureBound(onBound: () -> Unit) {
        if (musicService != null) {
            onBound()
            return
        }

        bindCallbacks.add(onBound)
        if (binding) {
            return
        }
        binding = true
        try {
            val intent = Intent().setClassName(
                reactContext.packageName,
                MUSIC_SERVICE_CLASS,
            )
            val connected = reactContext.bindService(
                intent,
                serviceConnection,
                Context.BIND_AUTO_CREATE,
            )
            if (!connected) {
                binding = false
                bindCallbacks.clear()
            }
        } catch (t: Throwable) {
            binding = false
            bindCallbacks.clear()
            Log.w(TAG, "绑定播放服务失败", t)
        }
    }

    private fun tryApply(params: ReverbParams) {
        if (!targetEnabled) {
            return
        }
        val exoPlayer = findExoPlayer()
        if (exoPlayer == null) {
            scheduleRetry()
            return
        }

        var sessionId = getAudioSessionId(exoPlayer)
        if (sessionId <= 0) {
            sessionId = createAudioSessionId(exoPlayer)
        }
        if (sessionId <= 0) {
            scheduleRetry()
            return
        }

        val current = effect
        if (current != null && attachedSessionId == sessionId) {
            try {
                applyParams(current, params)
            } catch (t: Throwable) {
                releaseEffect()
                scheduleRetry()
            }
            return
        }

        releaseEffect()

        val newEffect = try {
            // 0 == AudioEffect.EFFECT_PRIORITY_NORMAL（该常量在公开 SDK 中不可见）
            EnvironmentalReverb(0, sessionId)
        } catch (t: Throwable) {
            Log.w(TAG, "创建 EnvironmentalReverb 失败，session=$sessionId", t)
            null
        }

        if (newEffect == null) {
            // 设备不支持，或者音频轨道尚未创建，稍后重试
            scheduleRetry()
            return
        }

        effect = newEffect
        attachedSessionId = sessionId
        try {
            applyParams(newEffect, params)
            // 注意：AudioEffect.setEnabled 返回 int，不是 Kotlin 的合成属性
            newEffect.setEnabled(true)
            retryCount = 0
        } catch (t: Throwable) {
            Log.w(TAG, "应用混响参数失败", t)
            releaseEffect()
            scheduleRetry()
        }
    }

    private fun scheduleRetry() {
        if (!targetEnabled || retryCount >= MAX_RETRY_COUNT) {
            return
        }
        retryCount++
        mainHandler.postDelayed({
            if (targetEnabled) {
                applyInternal()
            }
        }, RETRY_INTERVAL_MS)
    }

    private fun releaseEffect() {
        val current = effect ?: return
        effect = null
        attachedSessionId = 0
        try {
            current.setEnabled(false)
        } catch (_: Throwable) {
        }
        try {
            current.release()
        } catch (_: Throwable) {
        }
    }

    private fun applyParams(effect: EnvironmentalReverb, params: ReverbParams) {
        effect.setRoomLevel(params.roomLevel.coerceIn(-9000, 0).toShort())
        effect.setRoomHFLevel(params.roomHFLevel.coerceIn(-9000, 0).toShort())
        effect.setDecayTime(params.decayTime.coerceIn(100, 20000))
        effect.setDecayHFRatio(params.decayHFRatio.coerceIn(100, 2000).toShort())
        effect.setReflectionsLevel(
            params.reflectionsLevel.coerceIn(-9000, 1000).toShort()
        )
        effect.setReflectionsDelay(params.reflectionsDelay.coerceIn(0, 300))
        effect.setReverbLevel(params.reverbLevel.coerceIn(-9000, 2000).toShort())
        effect.setReverbDelay(params.reverbDelay.coerceIn(0, 100))
        effect.setDiffusion(params.diffusion.coerceIn(0, 1000).toShort())
        effect.setDensity(params.density.coerceIn(0, 1000).toShort())
    }

    // ------------------------------------------------------------------
    // 反射工具：拿到 ExoPlayer / audioSessionId
    // ------------------------------------------------------------------

    private fun findExoPlayer(): Any? {
        val service = musicService ?: return null
        val player = readField(service, "player") ?: return null
        return try {
            player.javaClass.getMethod("getExoPlayer").invoke(player)
        } catch (t: Throwable) {
            null
        }
    }

    private fun readField(target: Any, name: String): Any? {
        return try {
            val field = target.javaClass.getDeclaredField(name)
            field.isAccessible = true
            field.get(target)
        } catch (t: Throwable) {
            null
        }
    }

    private fun getAudioSessionId(exoPlayer: Any): Int {
        return try {
            val value = exoPlayer.javaClass
                .getMethod("getAudioSessionId")
                .invoke(exoPlayer)
            (value as? Int) ?: 0
        } catch (t: Throwable) {
            0
        }
    }

    private fun createAudioSessionId(exoPlayer: Any): Int {
        return try {
            val audioManager = reactContext
                .getSystemService(Context.AUDIO_SERVICE) as? AudioManager
                ?: return 0
            val newId = audioManager.generateAudioSessionId()
            if (newId <= 0) {
                return 0
            }
            exoPlayer.javaClass
                .getMethod("setAudioSessionId", Integer.TYPE)
                .invoke(exoPlayer, newId)
            val current = getAudioSessionId(exoPlayer)
            if (current > 0) current else newId
        } catch (t: Throwable) {
            Log.w(TAG, "创建 audioSessionId 失败", t)
            0
        }
    }

    // ------------------------------------------------------------------
    // 参数解析
    // ------------------------------------------------------------------

    private data class ReverbParams(
        val roomLevel: Int,
        val roomHFLevel: Int,
        val decayTime: Int,
        val decayHFRatio: Int,
        val reflectionsLevel: Int,
        val reflectionsDelay: Int,
        val reverbLevel: Int,
        val reverbDelay: Int,
        val diffusion: Int,
        val density: Int,
    )

    private fun parseParams(map: ReadableMap): ReverbParams {
        return ReverbParams(
            roomLevel = map.intOr("roomLevel", -1000),
            roomHFLevel = map.intOr("roomHFLevel", -900),
            decayTime = map.intOr("decayTime", 800),
            decayHFRatio = map.intOr("decayHFRatio", 700),
            reflectionsLevel = map.intOr("reflectionsLevel", -2000),
            reflectionsDelay = map.intOr("reflectionsDelay", 20),
            reverbLevel = map.intOr("reverbLevel", 0),
            reverbDelay = map.intOr("reverbDelay", 20),
            diffusion = map.intOr("diffusion", 800),
            density = map.intOr("density", 800),
        )
    }

    private fun ReadableMap.intOr(key: String, defaultValue: Int): Int {
        return try {
            if (hasKey(key) && !isNull(key)) {
                getDouble(key).toInt()
            } else {
                defaultValue
            }
        } catch (t: Throwable) {
            defaultValue
        }
    }
}
