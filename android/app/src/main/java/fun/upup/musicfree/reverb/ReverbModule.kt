package `fun`.upup.musicfree.reverb

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.media.AudioManager
import android.media.audiofx.AudioEffect
import android.media.audiofx.EnvironmentalReverb
import android.media.audiofx.Equalizer
import android.media.audiofx.PresetReverb
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
 *  1. 绑定 react-native-track-player 的 MusicService，反射拿到 QueuedAudioPlayer，
 *     再通过公开的 getExoPlayer() 取得 ExoPlayer。
 *  2. 读取 / 生成 ExoPlayer 的 audioSessionId，把系统混响效果挂到本应用自己的音频会话上。
 *  3. 效果器有两套：优先 EnvironmentalReverb（可精细调节），
 *     设备不支持时退化为 PresetReverb（只能选房间类型）。
 *  4. 播放未开始时 session 还没生成，会定时重试；连续失败会在状态里给出原因，
 *     方便前端展示「为什么不可用」。
 */
class ReverbModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "ReverbModule"
        private const val MUSIC_SERVICE_CLASS =
            "com.doublesymmetry.trackplayer.service.MusicService"
        private const val RETRY_INTERVAL_MS = 500L
        private const val MAX_RETRY_COUNT = 40
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    private var musicService: Any? = null
    private var binding = false
    private var bindCallbacks: MutableList<() -> Unit> = mutableListOf()

    /** 当前挂载的效果器 */
    private var effect: AudioEffect? = null
    /** environmental / preset */
    private var effectKind: String? = null
    private var attachedSessionId = 0

    private var targetEnabled = false
    private var targetParams: ReverbParams? = null
    private var targetPresetId = "studio"
    private var targetIntensity = 60

    private var retryCount = 0
    private var gaveUp = false
    private var lastError: String? = null

    /** 缓存设备上是否存在对应类型的系统效果器 */
    private var deviceEffects: Pair<Boolean, Boolean>? = null

    /** 优先尝试的效果器类型（上一次未被系统接管就会切换） */
    private var preferredKind = "environmental"

    /** 诊断用：均衡器（确认系统音效链路是否真的生效） */
    private var eqEffect: Equalizer? = null
    private var eqTesting = false

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

    @ReactMethod
    fun update(
        enabled: Boolean,
        params: ReadableMap?,
        presetId: String?,
        intensity: Int,
        promise: Promise,
    ) {
        runOnMain {
            try {
                targetEnabled = enabled
                targetParams = params?.let { parseParams(it) }
                targetPresetId = presetId ?: "studio"
                targetIntensity = intensity
                retryCount = 0
                gaveUp = false
                lastError = null

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

    /** 强制重新挂载：切歌/真正开始播放后再挂一次，部分机型只有此时才吃效果 */
    @ReactMethod
    fun forceReattach(promise: Promise) {
        runOnMain {
            try {
                if (targetEnabled) {
                    releaseEffect()
                    retryCount = 0
                    gaveUp = false
                    applyInternal()
                }
                promise.resolve(buildStatus())
            } catch (t: Throwable) {
                promise.reject("reverb_reattach_failed", t)
            }
        }
    }

    /** 诊断：给 60Hz 加 +12dB，用来判断系统音效链路到底通不通 */
    @ReactMethod
    fun testEqualizer(enabled: Boolean, promise: Promise) {
        runOnMain {
            try {
                releaseEqualizer()
                eqTesting = enabled
                if (enabled) {
                    val exo = findExoPlayer()
                    var sid = exo?.let { getAudioSessionId(it) } ?: 0
                    if (sid <= 0 && exo != null) {
                        sid = createAudioSessionId(exo)
                    }
                    if (sid > 0) {
                        val eq = Equalizer(0, sid)
                        val bands = eq.numberOfBands
                        if (bands > 0) {
                            val center = eq.getBand(0).toInt()
                            eq.setBandLevel(0, 1200)
                            eq.setEnabled(true)
                            eqEffect = eq
                            lastError = null
                            eqTesting = eq.hasControl()
                            Log.i(TAG, "EQ 测试: bands=$bands center=$center session=$sid control=" + eq.hasControl())
                        } else {
                            lastError = "设备没有均衡器频段"
                        }
                    } else {
                        lastError = "无法获取音频会话"
                    }
                }
                promise.resolve(buildStatus())
            } catch (t: Throwable) {
                lastError = "均衡器测试失败: " + (t.message ?: t.javaClass.simpleName)
                promise.resolve(buildStatus())
            }
        }
    }

    private fun releaseEqualizer() {
        val eq = eqEffect ?: return
        eqEffect = null
        eqTesting = false
        try {
            eq.setEnabled(false)
        } catch (_: Throwable) {
        }
        try {
            eq.release()
        } catch (_: Throwable) {
        }
    }

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
        val effects = queryDeviceEffects()
        status.putBoolean("supported", effect != null)
        status.putBoolean("enabled", targetEnabled && effect != null)
        status.putInt("sessionId", attachedSessionId)
        status.putString("effectKind", effectKind)
        status.putString("error", lastError)
        status.putBoolean("gaveUp", gaveUp)
        status.putBoolean("envAvailable", effects.first)
        status.putBoolean("presetAvailable", effects.second)
        status.putBoolean("hasControl", effect?.hasControl() ?: false)
        status.putBoolean("eqTesting", eqTesting)
        status.putBoolean("eqHasControl", eqEffect?.hasControl() ?: false)
        val exo = findExoPlayer()
        status.putInt("liveSessionId", if (exo != null) getAudioSessionId(exo) else 0)
        return status
    }

    // ------------------------------------------------------------------
    // 挂载
    // ------------------------------------------------------------------

    private fun applyInternal() {
        if (!targetEnabled) {
            return
        }
        val params = targetParams ?: return
        ensureBound { tryApply(params) }
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
                lastError = "绑定播放服务失败"
            }
        } catch (t: Throwable) {
            binding = false
            bindCallbacks.clear()
            lastError = "绑定播放服务失败: " + (t.message ?: "")
            Log.w(TAG, "绑定播放服务失败", t)
        }
    }

    private fun tryApply(params: ReverbParams) {
        if (!targetEnabled) {
            return
        }
        val exoPlayer = findExoPlayer()
        if (exoPlayer == null) {
            scheduleRetry("播放器尚未就绪")
            return
        }

        var sessionId = getAudioSessionId(exoPlayer)
        if (sessionId <= 0) {
            sessionId = createAudioSessionId(exoPlayer)
        }
        if (sessionId <= 0) {
            scheduleRetry("无法获取音频会话")
            return
        }

        val current = effect
        if (current != null && attachedSessionId == sessionId) {
            try {
                applyParams()
                current.setEnabled(true)
                lastError = null
            } catch (t: Throwable) {
                lastError = "应用参数失败: " + (t.message ?: "")
                releaseEffect()
                scheduleRetry(lastError!!)
            }
            return
        }

        releaseEffect()
        val created = createEffect(sessionId, params)
        if (created == null) {
            scheduleRetry(lastError ?: "设备未提供混响效果器")
            return
        }

        effect = created
        attachedSessionId = sessionId
        try {
            applyParams()
            created.setEnabled(true)
            retryCount = 0
            gaveUp = false
            lastError = null
            // 部分机型 API 能创建效果器，但音频框架并不接管（尤其蓝牙输出），
            // 记录 hasControl 并切换优先类型，让下一次调用再试另一种效果器。
            if (!created.hasControl()) {
                preferredKind = if (effectKind == "environmental") "preset" else "environmental"
                lastError = "效果器未被系统接管"
            }
        } catch (t: Throwable) {
            lastError = "启用效果失败: " + (t.message ?: "")
            Log.w(TAG, "应用混响参数失败", t)
            releaseEffect()
            scheduleRetry(lastError!!)
        }
    }

    /**
     * 优先参数化混响（EnvironmentalReverb），不支持时退化为预设混响（PresetReverb）。
     * 都不行则返回 null，并把原因写进 lastError。
     */
    private fun createEffect(sessionId: Int, params: ReverbParams): AudioEffect? {
        val errors = mutableListOf<String>()
        val order = if (preferredKind == "preset") {
            listOf("preset", "environmental")
        } else {
            listOf("environmental", "preset")
        }

        for (kind in order) {
            try {
                val created: AudioEffect = if (kind == "environmental") {
                    EnvironmentalReverb(0, sessionId)
                } else {
                    PresetReverb(0, sessionId)
                }
                effectKind = kind
                return created
            } catch (t: Throwable) {
                val name = if (kind == "environmental") "EnvironmentalReverb" else "PresetReverb"
                errors.add(name + ": " + (t.message ?: t.javaClass.simpleName))
                Log.w(TAG, "创建 " + name + " 失败, session=$sessionId", t)
            }
        }

        effectKind = null
        lastError = errors.joinToString(" | ")
        return null
    }

    private fun scheduleRetry(reason: String) {
        lastError = reason
        if (!targetEnabled || retryCount >= MAX_RETRY_COUNT) {
            gaveUp = retryCount >= MAX_RETRY_COUNT
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

    private fun applyParams() {
        val current = effect ?: return
        when (effectKind) {
            "environmental" -> applyEnvironmental(current as EnvironmentalReverb, targetParams ?: return)
            "preset" -> applyPresetReverb(current as PresetReverb)
        }
    }

    private fun applyEnvironmental(effect: EnvironmentalReverb, params: ReverbParams) {
        effect.setRoomLevel(params.roomLevel.coerceIn(-9000, 0).toShort())
        effect.setRoomHFLevel(params.roomHFLevel.coerceIn(-9000, 0).toShort())
        effect.setDecayTime(params.decayTime.coerceIn(100, 20000))
        effect.setDecayHFRatio(params.decayHFRatio.coerceIn(100, 2000).toShort())
        effect.setReflectionsLevel(params.reflectionsLevel.coerceIn(-9000, 1000).toShort())
        effect.setReflectionsDelay(params.reflectionsDelay.coerceIn(0, 300))
        effect.setReverbLevel(params.reverbLevel.coerceIn(-9000, 2000).toShort())
        effect.setReverbDelay(params.reverbDelay.coerceIn(0, 100))
        effect.setDiffusion(params.diffusion.coerceIn(0, 1000).toShort())
        effect.setDensity(params.density.coerceIn(0, 1000).toShort())
    }

    /** PresetReverb 无法调节参数，只能按预设 + 强度挑一个房间类型 */
    private fun applyPresetReverb(effect: PresetReverb) {
        val preset = if (targetIntensity < 15) {
            PresetReverb.PRESET_NONE
        } else {
            when (targetPresetId) {
                "studio" -> if (targetIntensity < 55) PresetReverb.PRESET_SMALLROOM else PresetReverb.PRESET_MEDIUMROOM
                "room" -> PresetReverb.PRESET_SMALLROOM
                "ktv" -> PresetReverb.PRESET_MEDIUMROOM
                "theater" -> PresetReverb.PRESET_LARGEROOM
                "hall" -> if (targetIntensity < 60) PresetReverb.PRESET_MEDIUMHALL else PresetReverb.PRESET_LARGEHALL
                "concert" -> PresetReverb.PRESET_LARGEHALL
                else -> PresetReverb.PRESET_MEDIUMROOM
            }
        }
        effect.setPreset(preset)
    }

    // ------------------------------------------------------------------
    // 反射：拿到 ExoPlayer / audioSessionId
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
            val value = exoPlayer.javaClass.getMethod("getAudioSessionId").invoke(exoPlayer)
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
    // 设备能力 & 参数解析
    // ------------------------------------------------------------------

    private fun queryDeviceEffects(): Pair<Boolean, Boolean> {
        deviceEffects?.let { return it }
        var env = false
        var preset = false
        try {
            AudioEffect.queryEffects()?.forEach { descriptor ->
                if (descriptor.type == AudioEffect.EFFECT_TYPE_ENV_REVERB) {
                    env = true
                }
                if (descriptor.type == AudioEffect.EFFECT_TYPE_PRESET_REVERB) {
                    preset = true
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "查询系统效果器失败", t)
        }
        val result = Pair(env, preset)
        deviceEffects = result
        return result
    }

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
