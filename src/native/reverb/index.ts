import { NativeModule, NativeModules, Platform } from "react-native";

/**
 * 混响参数，单位与 Android EnvironmentalReverb 一致
 *  - 电平类：mB（毫贝），-9000 ~ 0 / 2000
 *  - 时间类：毫秒
 *  - 比例类：千分比（0 ~ 1000）
 */
export interface IReverbParams {
    roomLevel: number;
    roomHFLevel: number;
    decayTime: number;
    decayHFRatio: number;
    reflectionsLevel: number;
    reflectionsDelay: number;
    reverbLevel: number;
    reverbDelay: number;
    diffusion: number;
    density: number;
    /** 软件 DSP：湿声电平 dB */
    dspWetDb?: number;
    /** 软件 DSP：衰减时间 RT60 秒 */
    dspRt60?: number;
    /** 软件 DSP：高频阻尼 1.5~3.5 */
    dspHf?: number;
    /** 软件 DSP：扩散 0~1 */
    dspDiff?: number;
    /** 软件 DSP：预延迟 ms */
    dspPre?: number;
    /** 软件 DSP：立体声宽度 0~1 */
    dspWidth?: number;
}

export interface INativeReverbStatus {
    /** 是否已成功挂载效果器 */
    supported: boolean;
    /** 当前是否处于开启状态 */
    enabled: boolean;
    /** 挂载的 audioSessionId */
    sessionId: number;
    /** environmental = 参数化混响，preset = 预设混响，null = 未挂载 */
    effectKind: "environmental" | "preset" | null;
    /** 最近一次失败原因 */
    error: string | null;
    /** 是否已经重试到上限（真的不可用） */
    gaveUp: boolean;
    /** 系统是否存在参数化混响效果器 */
    envAvailable: boolean;
    /** 系统是否存在预设混响效果器 */
    presetAvailable: boolean;
    /** 效果器是否被音频框架真正接管（false 时通常听不出变化） */
    hasControl: boolean;
    /** 诊断用：均衡器测试是否在进行 */
    eqTesting: boolean;
    /** 诊断用：均衡器是否被接管 */
    eqHasControl: boolean;
    /** 播放器当前真实的 audioSessionId */
    liveSessionId: number;
    /** 软件 DSP 是否挂载成功 */
    dspInstalled: boolean;
    /** 软件 DSP 挂载失败原因 */
    dspError: string | null;
    /** 诊断：是否拿到了 ExoPlayer */
    playerFound: boolean;
    /** 诊断：configure 次数 */
    dspConfigureCount: number;
    /** 诊断：已处理帧数 */
    dspFrames: number;
    /** 诊断：采样率 */
    dspSampleRate: number;
    /** 诊断：声道数 */
    dspChannels: number;
    /** 诊断：当前湿声电平 dB */
    dspWetDb: number;
}

export interface INativeReverb extends NativeModule {
    update: (
        enabled: boolean,
        params: IReverbParams,
        presetId: string,
        intensity: number,
    ) => Promise<INativeReverbStatus>;
    disable: () => Promise<INativeReverbStatus>;
    getStatus: () => Promise<INativeReverbStatus>;
    forceReattach: () => Promise<INativeReverbStatus>;
    prepareDsp: () => Promise<INativeReverbStatus>;
    testEqualizer: (enabled: boolean) => Promise<INativeReverbStatus>;
    setEq: (gains: number[]) => Promise<INativeReverbStatus>;
}

/** 仅 Android 端有原生混响模块 */
const NativeReverb: INativeReverb | null =
    Platform.OS === "android" ? NativeModules.Reverb ?? null : null;

export default NativeReverb;
