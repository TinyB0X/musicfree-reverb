package `fun`.upup.musicfree.reverb

import com.google.android.exoplayer2.C
import com.google.android.exoplayer2.audio.AudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.tanh

/**
 * 软件混响（Freeverb）。
 *
 * 不依赖机型的系统音效，直接在解码后的 PCM 上做运算，所以任何设备都有效果。
 * 只处理 16bit PCM；其它格式直接透传（返回 NOT_SET，ExoPlayer 会自动把本处理器摘掉）。
 */
class ReverbAudioProcessor : AudioProcessor {

    // ---- 可调参数（由 ReverbModule 写入） ----
    @Volatile var enabled: Boolean = false
    /** 0..1，湿声比例 */
    @Volatile var wet: Float = 0f
    /** 0..1，房间大小 -> 反馈量 */
    @Volatile var roomSize: Float = 0.6f
    /** 0..1，阻尼 */
    @Volatile var damping: Float = 0.4f
    /** 毫秒 */
    @Volatile var preDelayMs: Float = 20f
    /** 立体声宽度 0..1 */
    @Volatile var width: Float = 1f

    private var inputFormat: AudioProcessor.AudioFormat = AudioProcessor.AudioFormat.NOT_SET
    private var outputBuffer: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var pendingEos = false

    private var sampleRate = 44100
    private var channelCount = 2

    private var engine: Freeverb? = null

    /** 预延迟缓冲（固定 300ms，运行时只改读取偏移，保证参数即时生效） */
    private var preDelayBuf = FloatArray(0)
    private var preDelayPos = 0

    /** 湿声平滑，避免开关瞬间爆音 */
    private var wetCurrent = 0f

    /** 诊断计数：configure 调了几次、处理了多少帧 */
    @Volatile var configureCount: Int = 0
    @Volatile var processedFrames: Long = 0
    @Volatile var lastSampleRate: Int = 0
    @Volatile var lastChannels: Int = 0

    override fun configure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT) {
            inputFormat = AudioProcessor.AudioFormat.NOT_SET
            return AudioProcessor.AudioFormat.NOT_SET
        }
        inputFormat = inputAudioFormat
        configureCount++
        lastSampleRate = inputAudioFormat.sampleRate
        lastChannels = inputAudioFormat.channelCount
        sampleRate = inputAudioFormat.sampleRate.coerceAtLeast(8000)
        channelCount = inputAudioFormat.channelCount.coerceAtLeast(1)
        engine = Freeverb(sampleRate)
        preDelayBuf = FloatArray((sampleRate * 0.3f).toInt().coerceAtLeast(16))
        preDelayPos = 0
        return inputAudioFormat
    }

    override fun isActive(): Boolean = inputFormat != AudioProcessor.AudioFormat.NOT_SET

    override fun queueInput(inputBuffer: ByteBuffer) {
        val size = inputBuffer.remaining()
        if (size == 0) {
            return
        }

        val out = if (outputBuffer.capacity() < size) {
            ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder())
        } else {
            outputBuffer
        }
        out.clear()

        val src = inputBuffer.order(ByteOrder.nativeOrder()).asShortBuffer()
        val dst = out.order(ByteOrder.nativeOrder()).asShortBuffer()

        val engineRef = engine
        val targetWet = if (enabled) wet.coerceIn(0f, 1f) else 0f
        val active = engineRef != null && (targetWet > 0.005f || wetCurrent > 0.005f)

        if (!active) {
            // 完全透传（关闭且湿声已归零）
            wetCurrent = 0f
            dst.put(src)
            inputBuffer.position(inputBuffer.limit())
        } else {
            val delaySamples = (preDelayMs.coerceIn(0f, 250f) / 1000f * sampleRate).toInt()
                .coerceIn(0, preDelayBuf.size - 1)
            engineRef.setParams(roomSize, damping)

            val frames = size / 2 / channelCount
            processedFrames += frames.toLong()

            for (i in 0 until frames) {
                val left = src.get().toInt() / 32768f
                val right = if (channelCount >= 2) src.get().toInt() / 32768f else left
                for (c in 2 until channelCount) {
                    src.get()
                }

                // 预延迟（可运行时调整）
                val mono = (left + right) * 0.5f
                var fed = mono
                if (preDelayBuf.isNotEmpty()) {
                    if (delaySamples > 0) {
                        var readPos = preDelayPos - delaySamples
                        if (readPos < 0) {
                            readPos += preDelayBuf.size
                        }
                        fed = preDelayBuf[readPos]
                    }
                    preDelayBuf[preDelayPos] = mono
                    preDelayPos++
                    if (preDelayPos >= preDelayBuf.size) {
                        preDelayPos = 0
                    }
                }

                // 湿声平滑（约 25ms），避免开关/切歌时爆音
                wetCurrent += (targetWet - wetCurrent) * 0.0008f
                val dryGain = 1f - 0.45f * wetCurrent
                val wetGain = wetCurrent * 0.85f

                val wetOut = engineRef.process(fed)

                val outL = left * dryGain + wetOut * wetGain
                val outR = right * dryGain + wetOut * wetGain

                dst.put(clampToShort(softClip(outL)))
                if (channelCount >= 2) {
                    dst.put(clampToShort(softClip(outR)))
                }
                for (c in 2 until channelCount) {
                    dst.put(0)
                }
            }
            inputBuffer.position(inputBuffer.limit())
        }

        out.position(0)
        out.limit(size)
        outputBuffer = out
    }

    /** 软限幅，避免鼓点叠加时硬削波爆音 */
    private fun softClip(value: Float): Float = tanh(value)

    private fun clampToShort(value: Float): Short {
        val v = (value * 32767f).toInt()
        return v.coerceIn(-32768, 32767).toShort()
    }

    override fun queueEndOfStream() {
        pendingEos = true
    }

    override fun getOutput(): ByteBuffer = outputBuffer

    override fun isEnded(): Boolean = pendingEos && outputBuffer === AudioProcessor.EMPTY_BUFFER

    override fun flush() {
        outputBuffer = AudioProcessor.EMPTY_BUFFER
        pendingEos = false
        engine?.reset()
        preDelayBuf.fill(0f)
        preDelayPos = 0
    }

    override fun reset() {
        flush()
        inputFormat = AudioProcessor.AudioFormat.NOT_SET
        engine = null
    }

    /**
     * Freeverb：8 个 comb + 4 个 allpass。
     * 参数参考原始实现（44100Hz 下的采样数），这里按采样率缩放。
     * 输入先压 0.15 做增益预留，输出再乘 0.8，保证鼓点不会顶到 0dBFS。
     */
    private class Freeverb(sampleRate: Int) {
        private val combTuning = intArrayOf(1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617)
        private val allpassTuning = intArrayOf(556, 441, 341, 225)
        private val scale = sampleRate / 44100f

        private val combBuf = Array(combTuning.size) { FloatArray((combTuning[it] * scale).toInt().coerceAtLeast(16)) }
        private val combIdx = IntArray(combTuning.size)
        private val combStore = FloatArray(combTuning.size)

        private val apBuf = Array(allpassTuning.size) { FloatArray((allpassTuning[it] * scale).toInt().coerceAtLeast(8)) }
        private val apIdx = IntArray(allpassTuning.size)

        private var feedback = 0.84f
        private var damp1 = 0.2f
        private var damp2 = 0.8f

        fun setParams(roomSize: Float, damping: Float) {
            this.feedback = (0.7f + roomSize.coerceIn(0f, 1f) * 0.28f)
            this.damp1 = damping.coerceIn(0f, 1f) * 0.4f
            this.damp2 = 1f - this.damp1
        }

        fun process(input: Float): Float {
            val x = input * INPUT_GAIN
            var acc = 0f
            for (i in combBuf.indices) {
                val buf = combBuf[i]
                val idx = combIdx[i]
                val out = buf[idx]
                combStore[i] = out * damp2 + combStore[i] * damp1
                buf[idx] = x + combStore[i] * feedback
                combIdx[i] = if (idx + 1 >= buf.size) 0 else idx + 1
                acc += out
            }
            for (i in apBuf.indices) {
                val buf = apBuf[i]
                val idx = apIdx[i]
                val bufOut = buf[idx]
                val output = -acc + bufOut
                buf[idx] = acc + bufOut * 0.5f
                apIdx[i] = if (idx + 1 >= buf.size) 0 else idx + 1
                acc = output
            }
            return acc * OUTPUT_GAIN
        }

        fun reset() {
            combBuf.forEach { it.fill(0f) }
            apBuf.forEach { it.fill(0f) }
            combIdx.fill(0)
            apIdx.fill(0)
            combStore.fill(0f)
        }

        private companion object {
            const val INPUT_GAIN = 0.15f
            const val OUTPUT_GAIN = 0.8f
        }
    }
}
