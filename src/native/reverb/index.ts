import { NativeModule, NativeModules, Platform } from "react-native";

/**
 * 混响参数，单位与 Android EnvironmentalReverb 一致
 *  - 电平类：mB（毫贝），-9000 ~ 0 / 2000
 *  - 时间类：毫秒
 *  - 比例类：千分比（0 ~ 1000）
 */
export interface IReverbParams {
    /** 房间混响电平 */
    roomLevel: number;
    /** 房间高频混响电平 */
    roomHFLevel: number;
    /** 衰减时间（ms） */
    decayTime: number;
    /** 高频衰减比例 */
    decayHFRatio: number;
    /** 早期反射电平 */
    reflectionsLevel: number;
    /** 早期反射延迟（ms） */
    reflectionsDelay: number;
    /** 混响（湿声）电平 */
    reverbLevel: number;
    /** 混响延迟（ms） */
    reverbDelay: number;
    /** 扩散度 */
    diffusion: number;
    /** 密度 */
    density: number;
}

export interface INativeReverbStatus {
    /** 是否已成功挂载混响效果 */
    supported: boolean;
    /** 当前是否处于开启状态 */
    enabled: boolean;
    /** 挂载的 audioSessionId */
    sessionId: number;
}

export interface INativeReverb extends NativeModule {
    update: (
        enabled: boolean,
        params: IReverbParams,
    ) => Promise<INativeReverbStatus>;
    disable: () => Promise<INativeReverbStatus>;
    getStatus: () => Promise<INativeReverbStatus>;
}

/** 仅 Android 端有原生混响模块 */
const NativeReverb: INativeReverb | null =
    Platform.OS === "android" ? NativeModules.Reverb ?? null : null;

export default NativeReverb;
