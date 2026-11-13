package `fun`.upup.musicfree.reverb

import com.google.android.exoplayer2.C
import com.google.android.exoplayer2.audio.AudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder

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
    private var bypassed = true

    private var sampleRate = 44100
    private var channelCount = 2

    private var engine: Freeverb? = null
    private var preDelay: FloatArray = FloatArray(0)
    private var preDelayPos = 0

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
        preDelay = FloatArray(((preDelayMs / 1000f) * sampleRate).toInt().coerceIn(0, sampleRate / 2))
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

        val active = enabled && wet > 0.001f
        val engineRef = engine
        if (!active || engineRef == null) {
            // 透传
            dst.put(src)
            inputBuffer.position(inputBuffer.limit())
        } else {
            engineRef.setParams(wet, roomSize, damping, width)
            val frames = size / 2 / channelCount
            processedFrames += frames.toLong()
            for (i in 0 until frames) {
                var left = src.get().toInt() / 32768f
                var right = if (channelCount >= 2) src.get().toInt() / 32768f else left
                // 跳过多余声道（5.1 等）
                for (c in 2 until channelCount) {
                    src.get()
                }

                // 预延迟
                if (preDelay.isNotEmpty()) {
                    val delayed = preDelay[preDelayPos]
                    preDelay[preDelayPos] = (left + right) * 0.5f
                    preDelayPos = (preDelayPos + 1) % preDelay.size
                    left += 0f * delayed
                }

                val wetOut = engineRef.process((left + right) * 0.5f)
                val dryL = left
                val dryR = right
                val outL = dryL * (1f - wet) + wetOut * wet * 1.2f
                val outR = dryR * (1f - wet) + wetOut * wet * 1.2f

                dst.put(clampToShort(outL))
                if (channelCount >= 2) {
                    dst.put(clampToShort(outR))
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
        preDelay.fill(0f)
        preDelayPos = 0
    }

    override fun reset() {
        flush()
        inputFormat = AudioProcessor.AudioFormat.NOT_SET
        engine = null
        bypassed = true
    }

    /**
     * Freeverb：8 个 comb + 4 个 allpass。
     * 参数参考原始实现（44100Hz 下的采样数），这里按采样率缩放。
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

        private var wet = 0.3f
        private var feedback = 0.84f
        private var damp1 = 0.2f
        private var damp2 = 0.8f
        private var width = 1f

        fun setParams(wet: Float, roomSize: Float, damping: Float, width: Float) {
            this.wet = wet.coerceIn(0f, 1f)
            this.feedback = (0.7f + roomSize.coerceIn(0f, 1f) * 0.28f)
            this.damp1 = damping.coerceIn(0f, 1f) * 0.4f
            this.damp2 = 1f - this.damp1
            this.width = width.coerceIn(0f, 1f)
        }

        fun process(input: Float): Float {
            var acc = 0f
            for (i in combBuf.indices) {
                val buf = combBuf[i]
                val idx = combIdx[i]
                val out = buf[idx]
                combStore[i] = out * damp2 + combStore[i] * damp1
                buf[idx] = input + combStore[i] * feedback
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
            return acc * wet
        }

        fun reset() {
            combBuf.forEach { it.fill(0f) }
            apBuf.forEach { it.fill(0f) }
            combIdx.fill(0)
            apIdx.fill(0)
            combStore.fill(0f)
        }
    }
}
