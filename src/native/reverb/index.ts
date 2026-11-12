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
}

/** 仅 Android 端有原生混响模块 */
const NativeReverb: INativeReverb | null =
    Platform.OS === "android" ? NativeModules.Reverb ?? null : null;

export default NativeReverb;
