import NativeReverb, {
    INativeReverbStatus,
    IReverbParams,
} from "@/native/reverb";
import { errorLog } from "@/utils/log";
import PersistStatus from "@/utils/persistStatus";
import { GlobalState } from "@/utils/stateMapper";
import type { ILanguageData } from "@/types/core/i18n";

/** 网易云音乐的混响参数模型（提取自其 APK 的 assets/audioeffect/reverb 预设） */
export interface IReverbDspParams {
    /** 预延迟 ms */
    pdelay: number;
    /** 衰减时间 RT60 秒 */
    rt60: number;
    /** 高频阻尼 1.5 ~ 3.5 */
    hf: number;
    /** 扩散 0 ~ 1 */
    diff: number;
    /** 立体声宽度 0 ~ 1 */
    width: number;
    /** 湿声电平 dB */
    wetDb: number;
}

export interface IReverbAdvanced {
    /** 湿度 0~100（映射到 -40 ~ -3 dB） */
    wet?: number;
    /** 衰减秒 0.4 ~ 6 */
    decay?: number;
    /** 阻尼 1.5 ~ 3.5 */
    damping?: number;
    /** 预延迟 ms */
    preDelay?: number;
    /** 宽度 0 ~ 1 */
    width?: number;
}

export interface IReverbPreset {
    id: string;
    i18nKey: keyof ILanguageData;
    dsp: IReverbDspParams;
}

/** 数据来自网易云音乐 9.6.22 的 assets/audioeffect/reverb/*.json */
const presets: IReverbPreset[] = [
    {
        id: "bathroom",
        i18nKey: "panel.reverb.preset.bathroom",
        dsp: { pdelay: 0, rt60: 3.59, hf: 2.0, diff: 0.4, width: 0.61, wetDb: -14 },
    },
    {
        id: "bright_chamber",
        i18nKey: "panel.reverb.preset.brightChamber",
        dsp: { pdelay: 25, rt60: 2.4, hf: 2.0, diff: 0.8, width: 1.0, wetDb: -14 },
    },
    {
        id: "large_room",
        i18nKey: "panel.reverb.preset.largeRoom",
        dsp: { pdelay: 25, rt60: 1.2, hf: 2.5, diff: 0.8, width: 0.83, wetDb: -11 },
    },
    {
        id: "large_hall",
        i18nKey: "panel.reverb.preset.largeHall",
        dsp: { pdelay: 130, rt60: 3.5, hf: 3.5, diff: 0.8, width: 1.0, wetDb: -18 },
    },
    {
        id: "recital_hall",
        i18nKey: "panel.reverb.preset.recitalHall",
        dsp: { pdelay: 100, rt60: 2.59, hf: 3.39, diff: 0.52, width: 0.89, wetDb: -15 },
    },
    {
        id: "pool",
        i18nKey: "panel.reverb.preset.pool",
        dsp: { pdelay: 50, rt60: 4.5, hf: 2.0, diff: 0.5, width: 0.61, wetDb: -17 },
    },
    {
        id: "night_club",
        i18nKey: "panel.reverb.preset.nightClub",
        dsp: { pdelay: 25, rt60: 1.5, hf: 2.79, diff: 0.8, width: 0.83, wetDb: -14 },
    },
    {
        id: "concrete_venue",
        i18nKey: "panel.reverb.preset.concreteVenue",
        dsp: { pdelay: 110, rt60: 2.5, hf: 2.79, diff: 0.44, width: 1.0, wetDb: -18 },
    },
    {
        id: "small_plate",
        i18nKey: "panel.reverb.preset.smallPlate",
        dsp: { pdelay: 0, rt60: 2.4, hf: 2.0, diff: 0.8, width: 0.5, wetDb: -13 },
    },
    {
        id: "vocal_plate",
        i18nKey: "panel.reverb.preset.vocalPlate",
        dsp: { pdelay: 0, rt60: 1.2, hf: 1.78, diff: 0.8, width: 0.83, wetDb: -12 },
    },
];

function clamp(value: number, min: number, max: number) {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(max, Math.max(min, value));
}

export function getReverbPresets() {
    return presets;
}

export function getReverbPreset(id?: string) {
    return presets.find(_ => _.id === id) ?? presets[0];
}

/** 把预设 + 强度 + 高级参数换算成原生要的参数 */
export function buildReverbParams(
    presetId: string,
    intensity: number,
    advanced?: IReverbAdvanced,
): IReverbParams {
    const preset = getReverbPreset(presetId);
    const ratio = clamp(intensity, 0, 100) / 100;

    // 预设里是网易云的原始电平（-17~-25dB），这里整体 +8dB 并随强度微调，
    // 保证在手机上能明显听出来（网易云还有早反射/多段滤波加持）
    let wetDb = clamp(preset.dsp.wetDb + 8 - (1 - ratio) * 12, -60, -3);
    let rt60 = preset.dsp.rt60;
    let hf = preset.dsp.hf;
    let pre = preset.dsp.pdelay;
    let width = preset.dsp.width;
    const diff = preset.dsp.diff;

    if (typeof advanced?.wet === "number") {
        wetDb = -40 + clamp(advanced.wet, 0, 100) / 100 * 37;
    }
    if (typeof advanced?.decay === "number") {
        rt60 = clamp(advanced.decay, 0.4, 6);
    }
    if (typeof advanced?.damping === "number") {
        hf = clamp(advanced.damping, 1.5, 3.5);
    }
    if (typeof advanced?.preDelay === "number") {
        pre = clamp(advanced.preDelay, 0, 150);
    }
    if (typeof advanced?.width === "number") {
        width = clamp(advanced.width, 0, 1);
    }

    // 系统效果器那套参数保留（不再使用，但对接口兼容）
    return {
        roomLevel: 0,
        roomHFLevel: 0,
        decayTime: Math.round(rt60 * 1000),
        decayHFRatio: 500,
        reflectionsLevel: 0,
        reflectionsDelay: Math.round(pre),
        reverbLevel: 0,
        reverbDelay: 20,
        diffusion: Math.round(diff * 1000),
        density: 700,
        dspWetDb: wetDb,
        dspRt60: rt60,
        dspHf: hf,
        dspDiff: diff,
        dspPre: pre,
        dspWidth: width,
    };
}

const enabledStore = new GlobalState<boolean>(
    PersistStatus.get("audio.reverbEnabled") ?? false,
);
const presetStore = new GlobalState<string>(
    getReverbPreset(PersistStatus.get("audio.reverbPreset") ?? undefined).id,
);
const intensityStore = new GlobalState<number>(
    clamp(PersistStatus.get("audio.reverbIntensity") ?? 70, 0, 100),
);
const supportedStore = new GlobalState<boolean>(!!NativeReverb);
const statusStore = new GlobalState<INativeReverbStatus | null>(null);
const advancedStore = new GlobalState<IReverbAdvanced>(
    PersistStatus.get("audio.reverbAdvanced") ?? {},
);

export function useReverbEnabled() {
    return enabledStore.useValue();
}

export function useReverbPreset() {
    return presetStore.useValue();
}

export function useReverbIntensity() {
    return intensityStore.useValue();
}

export function useReverbSupported() {
    return supportedStore.useValue();
}

export function useReverbStatus() {
    return statusStore.useValue();
}

export function useReverbAdvanced() {
    return advancedStore.useValue();
}

export function useEqTesting() {
    const status = statusStore.useValue();
    return !!status?.eqTesting;
}

export function isReverbAvailable() {
    return !!NativeReverb;
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let statusTimers: Array<ReturnType<typeof setTimeout>> = [];

function clearStatusTimers() {
    statusTimers.forEach(_ => clearTimeout(_));
    statusTimers = [];
}

async function refreshStatus() {
    if (!NativeReverb) {
        return;
    }
    try {
        const status = await NativeReverb.getStatus();
        statusStore.setValue(status);
        if (status.dspInstalled) {
            supportedStore.setValue(true);
        }
    } catch {}
}

function scheduleStatusRefresh() {
    clearStatusTimers();
    [600, 1800, 4000, 8000].forEach(delay => {
        statusTimers.push(setTimeout(() => refreshStatus(), delay));
    });
}

async function pushToNative() {
    if (!NativeReverb) {
        return;
    }
    const enabled = enabledStore.getValue();
    try {
        const status = await NativeReverb.update(
            enabled,
            buildReverbParams(
                presetStore.getValue(),
                intensityStore.getValue(),
                advancedStore.getValue(),
            ),
            presetStore.getValue(),
            intensityStore.getValue(),
        );
        statusStore.setValue(status);
        if (status.dspInstalled) {
            supportedStore.setValue(true);
        }
        scheduleStatusRefresh();
    } catch (e: any) {
        errorLog("混响参数应用失败", e?.message);
    }
}

function schedulePush(delay = 0) {
    if (pushTimer) {
        clearTimeout(pushTimer);
    }
    pushTimer = setTimeout(() => {
        pushTimer = null;
        pushToNative();
    }, delay);
}

export async function setReverbEnabled(enabled: boolean) {
    enabledStore.setValue(enabled);
    PersistStatus.set("audio.reverbEnabled", enabled);
    if (!enabled) {
        try {
            await NativeReverb?.disable();
        } catch {}
        clearStatusTimers();
        return;
    }
    schedulePush();
}

export async function setReverbPreset(id: string) {
    const preset = getReverbPreset(id);
    presetStore.setValue(preset.id);
    PersistStatus.set("audio.reverbPreset", preset.id);
    if (!enabledStore.getValue()) {
        setReverbEnabled(true);
        return;
    }
    schedulePush();
}

export async function setReverbIntensity(intensity: number) {
    const value = clamp(Math.round(intensity), 0, 100);
    intensityStore.setValue(value);
    PersistStatus.set("audio.reverbIntensity", value);
    schedulePush(60);
}

export async function setReverbAdvanced(advanced: IReverbAdvanced) {
    advancedStore.setValue(advanced);
    PersistStatus.set("audio.reverbAdvanced", advanced);
    if (enabledStore.getValue()) {
        schedulePush(40);
    }
}

export async function resetReverbAdvanced() {
    advancedStore.setValue({});
    PersistStatus.set("audio.reverbAdvanced", {});
    if (enabledStore.getValue()) {
        schedulePush();
    }
}

export async function setEqTest(enabled: boolean) {
    try {
        if (enabled) {
            await NativeReverb?.testEqualizer(true);
        } else {
            await NativeReverb?.testEqualizer(false);
        }
        scheduleStatusRefresh();
    } catch {}
}

export async function prepareDsp() {
    if (!NativeReverb) {
        return;
    }
    try {
        const status = await NativeReverb.prepareDsp();
        statusStore.setValue(status);
    } catch {}
}

export async function restoreReverb() {
    if (!NativeReverb) {
        return;
    }
    if (!enabledStore.getValue()) {
        supportedStore.setValue(true);
        return;
    }
    await pushToNative();
}

export function reapplyReverb() {
    if (!NativeReverb || !enabledStore.getValue()) {
        return;
    }
    schedulePush(200);
}

export async function forceReattachReverb() {
    if (!NativeReverb || !enabledStore.getValue()) {
        return;
    }
    try {
        const status = await NativeReverb.forceReattach();
        statusStore.setValue(status);
    } catch {}
}
