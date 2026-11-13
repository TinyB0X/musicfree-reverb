package `fun`.upup.musicfree.reverb

import android.util.Log
import com.google.android.exoplayer2.C
import com.google.android.exoplayer2.audio.AudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.sqrt

private const val TAG = "ReverbModule"

/**
 * 软件混响（Freeverb）。
 *
 * 设计原则：
 *  - 干声永远原样输出（不做增益衰减、不做全局压缩），所以"开了混响没声音"不可能发生
 *  - 湿声单独饱和，并且有 NaN/Inf 兜底
 *  - 连续"有输入但输出几乎静音"时自动旁路（fail-safe）
 */
class ReverbAudioProcessor : AudioProcessor {

    // ---- 可调参数 ----
    @Volatile var enabled: Boolean = false
    @Volatile var wet: Float = 0f
    @Volatile var roomSize: Float = 0.6f
    @Volatile var damping: Float = 0.4f
    @Volatile var preDelayMs: Float = 20f
    @Volatile var width: Float = 1f

    private var inputFormat: AudioProcessor.AudioFormat = AudioProcessor.AudioFormat.NOT_SET
    private var outputBuffer: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var pendingEos = false

    private var sampleRate = 44100
    private var channelCount = 2

    private var engine: Freeverb? = null

    private var preDelayBuf = FloatArray(0)
    private var preDelayPos = 0

    private var wetCurrent = 0f

    private var dcX1 = 0f
    private var dcY1 = 0f

    /** 自保护：连续输出异常静音时旁路 */
    private var silentWindows = 0
    @Volatile var faultBypass = false

    /** 诊断 */
    @Volatile var configureCount: Int = 0
    @Volatile var processedFrames: Long = 0
    @Volatile var lastSampleRate: Int = 0
    @Volatile var lastChannels: Int = 0
    @Volatile var lastInRms: Float = 0f
    @Volatile var lastOutRms: Float = 0f

    private var rmsInAcc = 0.0
    private var rmsOutAcc = 0.0
    private var rmsFrames = 0L

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
        wetCurrent = 0f
        dcX1 = 0f
        dcY1 = 0f
        silentWindows = 0
        faultBypass = false
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
        val targetWet = if (enabled && !faultBypass) wet.coerceIn(0f, 1f) else 0f
        val active = engineRef != null && (targetWet > 0.005f || wetCurrent > 0.005f)

        if (!active) {
            wetCurrent = 0f
            dst.put(src)
            inputBuffer.position(inputBuffer.limit())
        } else {
            val frameBytes = 2 * channelCount
            val frames = size / frameBytes
            val delaySamples = (preDelayMs.coerceIn(0f, 250f) / 1000f * sampleRate).toInt()
                .coerceIn(0, preDelayBuf.size - 1)
            engineRef!!.setParams(roomSize, damping)

            processedFrames += frames.toLong()

            for (i in 0 until frames) {
                val left = src.get().toInt() / 32768f
                val right = if (channelCount >= 2) src.get().toInt() / 32768f else left
                for (c in 2 until channelCount) {
                    src.get()
                }

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

                var wetOut = engineRef.process(fed)
                if (!wetOut.isFinite()) {
                    wetOut = 0f
                }
                val dcY = wetOut - dcX1 + 0.995f * dcY1
                dcX1 = wetOut
                dcY1 = if (dcY.isFinite()) dcY else 0f
                wetOut = dcY1

                wetCurrent += (targetWet - wetCurrent) * 0.0008f
                var wetSig = wetOut * wetCurrent * 0.45f
                if (!wetSig.isFinite()) {
                    wetSig = 0f
                }
                // 只对湿声饱和，干声永远不受影响
                wetSig /= (1f + abs(wetSig) * 2f)

                val sumL = knee(left + wetSig)
                val sumR = knee(right + wetSig)

                rmsInAcc += (mono * mono).toDouble()
                rmsOutAcc += ((sumL * sumL + sumR * sumR) * 0.5).toDouble()

                dst.put(clampToShort(sumL))
                if (channelCount >= 2) {
                    dst.put(clampToShort(sumR))
                }
                for (c in 2 until channelCount) {
                    dst.put(0)
                }
            }

            // 不完整尾帧补零，避免输出未初始化内存。
            // 注意：数据是写进 dst（ShortBuffer 视图）的，out 自己的 position 不会前进，
            // 所以这里必须用「已写字节数」来定位，否则会把刚写好的数据全部覆盖成 0（=静音）。
            val writtenBytes = frames * frameBytes
            if (writtenBytes < size) {
                out.position(writtenBytes)
                while (out.position() < size) {
                    out.put(0)
                }
            }
            inputBuffer.position(inputBuffer.limit())

            rmsFrames += frames
            if (rmsFrames >= sampleRate * 2L) {
                val inRms = sqrt(rmsInAcc / rmsFrames).toFloat()
                val outRms = sqrt(rmsOutAcc / rmsFrames).toFloat()
                lastInRms = inRms
                lastOutRms = outRms
                Log.i(TAG, "DSP inRMS=" + inRms + " outRMS=" + outRms + " wet=" + wetCurrent +
                        " frames=" + processedFrames + " bypass=" + faultBypass)
                if (inRms > 0.002f && outRms < inRms * 0.05f) {
                    silentWindows++
                    if (silentWindows >= 3) {
                        faultBypass = true
                        Log.w(TAG, "输出异常静音，自动旁路 DSP")
                    }
                } else {
                    silentWindows = 0
                }
                rmsInAcc = 0.0
                rmsOutAcc = 0.0
                rmsFrames = 0
            }
        }

        out.position(0)
        out.limit(size)
        outputBuffer = out
    }

    /** 超过 0.9 才轻微压缩尾巴，绝不影响正常音量 */
    private fun knee(v: Float): Float {
        val a = abs(v)
        if (a <= 0.9f) {
            return v
        }
        val sign = if (v < 0f) -1f else 1f
        return sign * (0.9f + (a - 0.9f) * 0.4f).coerceAtMost(0.98f)
    }

    private fun clampToShort(value: Float): Short {
        val v = if (value.isFinite()) (value.coerceIn(-1f, 1f) * 32767f).toInt() else 0
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
        wetCurrent = 0f
        dcX1 = 0f
        dcY1 = 0f
        rmsInAcc = 0.0
        rmsOutAcc = 0.0
        rmsFrames = 0
    }

    override fun reset() {
        flush()
        inputFormat = AudioProcessor.AudioFormat.NOT_SET
        engine = null
        faultBypass = false
    }

    /**
     * Freeverb：8 个 comb + 4 个 allpass。
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
            this.feedback = (0.7f + roomSize.coerceIn(0f, 1f) * 0.27f)
            this.damp1 = 0.05f + damping.coerceIn(0f, 1f) * 0.85f
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
            acc /= combBuf.size.toFloat()
            for (i in apBuf.indices) {
                val buf = apBuf[i]
                val idx = apIdx[i]
                val bufOut = buf[idx]
                val output = -acc + bufOut
                buf[idx] = acc + bufOut * 0.5f
                apIdx[i] = if (idx + 1 >= buf.size) 0 else idx + 1
                acc = output
            }
            return acc
        }

        fun reset() {
            combBuf.forEach { it.fill(0f) }
            apBuf.forEach { it.fill(0f) }
            combIdx.fill(0)
            apIdx.fill(0)
            combStore.fill(0f)
        }

        private companion object {
            const val INPUT_GAIN = 0.12f
        }
    }
}
