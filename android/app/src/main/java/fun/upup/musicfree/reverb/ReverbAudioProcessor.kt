package `fun`.upup.musicfree.reverb

import android.util.Log
import com.google.android.exoplayer2.C
import com.google.android.exoplayer2.audio.AudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.sqrt

private const val TAG = "ReverbModule"

/**
 * 软件混响（Freeverb 结构，按网易云音乐的参数模型实现）。
 *
 * 网易云的混响参数模型（从 APK 的 assets/audioeffect/reverb 里的 json 提取）：
 *   rvb.pdelay   预延迟 ms (0~130)
 *   rvb.dtime    衰减时间 s (1.2~4.5)
 *   rvb.hfdamping 高频阻尼 (1.78~3.5)
 *   rvb.density  密度 (50~100)
 *   rvb.rshape   房间形状 (40~100)
 *   rvb.diffusion 扩散 (40~80)
 *   rvb.swidth   立体声宽度 (90~180)
 *   ol.dry / ol.er / ol.rvb  干声 / 早反射 / 混响的输出电平(dB)
 *
 * 这里用相同的参数语义：RT60 换算成每个 comb 的反馈系数，宽度控制左右去相关。
 */
class ReverbAudioProcessor : AudioProcessor {

    // ---- 可调参数 ----
    @Volatile var enabled: Boolean = false
    /** 湿声电平，dB（相对干声，网易云 -17 ~ -25，这里范围 -40 ~ 0） */
    @Volatile var wetDb: Float = -12f
    /** 衰减时间 RT60，秒 */
    @Volatile var rt60: Float = 2.0f
    /** 高频阻尼，1.5 ~ 3.5 */
    @Volatile var hfDamping: Float = 2.4f
    /** 扩散 0 ~ 1 */
    @Volatile var diffusion: Float = 0.75f
    /** 立体声宽度 0 ~ 1（对应 90~180） */
    @Volatile var width: Float = 0.9f
    /** 预延迟 ms */
    @Volatile var preDelayMs: Float = 40f

    private var inputFormat: AudioProcessor.AudioFormat = AudioProcessor.AudioFormat.NOT_SET
    private var outputBuffer: ByteBuffer = AudioProcessor.EMPTY_BUFFER
    private var pendingEos = false

    private var sampleRate = 44100
    private var channelCount = 2

    private var engine: Freeverb? = null

    private var preDelayBuf = FloatArray(0)
    private var preDelayPos = 0

    private var wetCurrent = 0f

    private var silentWindows = 0
    @Volatile var faultBypass = false

    @Volatile var configureCount: Int = 0
    @Volatile var processedFrames: Long = 0
    @Volatile var lastSampleRate: Int = 0
    @Volatile var lastChannels: Int = 0
    @Volatile var lastInRms: Float = 0f
    @Volatile var lastOutRms: Float = 0f
    @Volatile var lastWetRms: Float = 0f

    private var rmsInAcc = 0.0
    private var rmsOutAcc = 0.0
    private var rmsWetAcc = 0.0
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
        preDelayBuf = FloatArray((sampleRate * 0.4f).toInt().coerceAtLeast(16))
        preDelayPos = 0
        wetCurrent = 0f
        silentWindows = 0
        faultBypass = false
        return inputAudioFormat
    }

    override fun isActive(): Boolean = inputFormat != AudioProcessor.AudioFormat.NOT_SET

    override fun queueInput(inputBuffer: ByteBuffer) {
        val size = inputBuffer.remaining()
        if (size == 0) return

        val out = if (outputBuffer.capacity() < size) {
            ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder())
        } else {
            outputBuffer
        }
        out.clear()

        val src = inputBuffer.order(ByteOrder.nativeOrder()).asShortBuffer()
        val dst = out.order(ByteOrder.nativeOrder()).asShortBuffer()

        val engineRef = engine
        val targetWet = if (enabled && !faultBypass) wetDb.coerceIn(-60f, 0f) else -60f
        val active = engineRef != null && (targetWet > -59f || wetCurrent > -59f)

        if (!active) {
            wetCurrent = -60f
            dst.put(src)
            inputBuffer.position(inputBuffer.limit())
        } else {
            val frameBytes = 2 * channelCount
            val frames = size / frameBytes
            val delaySamples = (preDelayMs.coerceIn(0f, 380f) / 1000f * sampleRate).toInt()
                .coerceIn(0, preDelayBuf.size - 1)
            engineRef!!.setParams(rt60, hfDamping, diffusion, width)

            processedFrames += frames.toLong()

            for (i in 0 until frames) {
                val left = src.get().toInt() / 32768f
                val right = if (channelCount >= 2) src.get().toInt() / 32768f else left
                for (c in 2 until channelCount) src.get()

                val mono = (left + right) * 0.5f

                var fed = mono
                if (preDelayBuf.isNotEmpty()) {
                    if (delaySamples > 0) {
                        var readPos = preDelayPos - delaySamples
                        if (readPos < 0) readPos += preDelayBuf.size
                        fed = preDelayBuf[readPos]
                    }
                    preDelayBuf[preDelayPos] = mono
                    preDelayPos++
                    if (preDelayPos >= preDelayBuf.size) preDelayPos = 0
                }

                val wet = engineRef.process(fed)
                if (!wet[0].isFinite() || !wet[1].isFinite()) {
                    wet[0] = 0f
                    wet[1] = 0f
                }

                // 湿声电平平滑（dB）
                wetCurrent += (targetWet - wetCurrent) * 0.0008f
                val wetLin = dbToLinear(wetCurrent)

                val sumL = knee(left + wet[0] * wetLin)
                val sumR = knee(right + wet[1] * wetLin)

                rmsInAcc += (mono * mono).toDouble()
                rmsOutAcc += ((sumL * sumL + sumR * sumR) * 0.5).toDouble()
                rmsWetAcc += ((wet[0] * wetLin) * (wet[0] * wetLin)).toDouble()

                dst.put(clampToShort(sumL))
                if (channelCount >= 2) dst.put(clampToShort(sumR))
                for (c in 2 until channelCount) dst.put(0)
            }

            val writtenBytes = frames * frameBytes
            if (writtenBytes < size) {
                out.position(writtenBytes)
                while (out.position() < size) out.put(0)
            }
            inputBuffer.position(inputBuffer.limit())

            rmsFrames += frames
            if (rmsFrames >= sampleRate * 2L) {
                val inRms = sqrt(rmsInAcc / rmsFrames).toFloat()
                val outRms = sqrt(rmsOutAcc / rmsFrames).toFloat()
                val wetRms = sqrt(rmsWetAcc / rmsFrames).toFloat()
                lastInRms = inRms
                lastOutRms = outRms
                lastWetRms = wetRms
                Log.i(TAG, "DSP inRMS=" + inRms + " outRMS=" + outRms + " wetRMS=" + wetRms +
                        " wetDb=" + wetCurrent + " rt60=" + rt60 + " frames=" + processedFrames +
                        " bypass=" + faultBypass)
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
                rmsWetAcc = 0.0
                rmsFrames = 0
            }
        }

        out.position(0)
        out.limit(size)
        outputBuffer = out
    }

    private fun dbToLinear(db: Float): Float {
        return 10f.pow(db / 20f)
    }

    private fun knee(v: Float): Float {
        val a = abs(v)
        if (a <= 0.9f) return v
        val sign = if (v < 0f) -1f else 1f
        return sign * (0.9f + (a - 0.9f) * 0.4f).coerceAtMost(0.98f)
    }

    private fun clampToShort(value: Float): Short {
        val v = if (value.isFinite()) (value.coerceIn(-1f, 1f) * 32767f).toInt() else 0
        return v.coerceIn(-32768, 32767).toShort()
    }

    override fun queueEndOfStream() { pendingEos = true }
    override fun getOutput(): ByteBuffer = outputBuffer
    override fun isEnded(): Boolean = pendingEos && outputBuffer === AudioProcessor.EMPTY_BUFFER

    override fun flush() {
        outputBuffer = AudioProcessor.EMPTY_BUFFER
        pendingEos = false
        engine?.reset()
        preDelayBuf.fill(0f)
        preDelayPos = 0
        wetCurrent = -60f
        rmsInAcc = 0.0
        rmsOutAcc = 0.0
        rmsWetAcc = 0.0
        rmsFrames = 0
    }

    override fun reset() {
        flush()
        inputFormat = AudioProcessor.AudioFormat.NOT_SET
        engine = null
        faultBypass = false
    }

    /**
     * Freeverb：8 comb + 4 allpass，左右两套 comb（右声道 +23 samples 去相关）。
     * 反馈系数由 RT60 与 comb 长度反推：fb = 10^(-3 * D / (RT60 * sr))
     */
    private class Freeverb(private val sampleRate: Int) {
        private val combTuning = intArrayOf(1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617)
        private val allpassTuning = intArrayOf(556, 441, 341, 225)
        private val scale = sampleRate / 44100f

        private val combLenL = IntArray(combTuning.size) { (combTuning[it] * scale).toInt().coerceAtLeast(16) }
        private val combLenR = IntArray(combTuning.size) { ((combTuning[it] + 23) * scale).toInt().coerceAtLeast(16) }
        private val combL = Array(combTuning.size) { FloatArray(combLenL[it]) }
        private val combR = Array(combTuning.size) { FloatArray(combLenR[it]) }
        private val idxL = IntArray(combTuning.size)
        private val idxR = IntArray(combTuning.size)
        private val storeL = FloatArray(combTuning.size)
        private val storeR = FloatArray(combTuning.size)
        private val fbL = FloatArray(combTuning.size)
        private val fbR = FloatArray(combTuning.size)

        private val apLenL = IntArray(allpassTuning.size) { (allpassTuning[it] * scale).toInt().coerceAtLeast(8) }
        private val apLenR = IntArray(allpassTuning.size) { ((allpassTuning[it] + 23) * scale).toInt().coerceAtLeast(8) }
        private val apL = Array(allpassTuning.size) { FloatArray(apLenL[it]) }
        private val apR = Array(allpassTuning.size) { FloatArray(apLenR[it]) }
        private val apIdxL = IntArray(allpassTuning.size)
        private val apIdxR = IntArray(allpassTuning.size)

        private var damp1 = 0.3f
        private var damp2 = 0.7f
        private var apCoef = 0.5f
        private var wet1 = 1f
        private var wet2 = 0f

        private val out = floatArrayOf(0f, 0f)

        fun setParams(rt60: Float, hfDamping: Float, diffusion: Float, width: Float) {
            val rt = rt60.coerceIn(0.4f, 8f)
            for (i in combL.indices) {
                fbL[i] = 10f.pow(-3f * combLenL[i] / (rt * sampleRate))
                fbR[i] = 10f.pow(-3f * combLenR[i] / (rt * sampleRate))
            }
            // 网易云 hfdamping 1.78~3.5 -> 低通系数
            val d = ((hfDamping - 1.5f) / 2.5f).coerceIn(0f, 1f)
            damp1 = 0.1f + d * 0.75f
            damp2 = 1f - damp1
            apCoef = (0.3f + diffusion.coerceIn(0f, 1f) * 0.4f)
            val w = width.coerceIn(0f, 1f)
            wet1 = w * 0.5f + 0.5f
            wet2 = (1f - w) * 0.5f
        }

        fun process(input: Float): FloatArray {
            val x = input * 0.12f
            var accL = 0f
            var accR = 0f
            for (i in combL.indices) {
                val bl = combL[i]
                val il = idxL[i]
                val outL = bl[il]
                storeL[i] = outL * damp2 + storeL[i] * damp1
                bl[il] = x + storeL[i] * fbL[i]
                idxL[i] = if (il + 1 >= bl.size) 0 else il + 1
                accL += outL

                val br = combR[i]
                val ir = idxR[i]
                val outR = br[ir]
                storeR[i] = outR * damp2 + storeR[i] * damp1
                br[ir] = x + storeR[i] * fbR[i]
                idxR[i] = if (ir + 1 >= br.size) 0 else ir + 1
                accR += outR
            }
            accL /= combL.size.toFloat()
            accR /= combR.size.toFloat()

            for (i in apL.indices) {
                val bl = apL[i]
                val il = apIdxL[i]
                val bo = bl[il]
                val o = -accL + bo
                bl[il] = accL + bo * apCoef
                apIdxL[i] = if (il + 1 >= bl.size) 0 else il + 1
                accL = o

                val br = apR[i]
                val ir = apIdxR[i]
                val boR = br[ir]
                val oR = -accR + boR
                br[ir] = accR + boR * apCoef
                apIdxR[i] = if (ir + 1 >= br.size) 0 else ir + 1
                accR = oR
            }

            out[0] = accL * wet1 + accR * wet2
            out[1] = accR * wet1 + accL * wet2
            return out
        }

        fun reset() {
            combL.forEach { it.fill(0f) }
            combR.forEach { it.fill(0f) }
            apL.forEach { it.fill(0f) }
            apR.forEach { it.fill(0f) }
            idxL.fill(0); idxR.fill(0); apIdxL.fill(0); apIdxR.fill(0)
            storeL.fill(0f); storeR.fill(0f)
        }
    }
}
