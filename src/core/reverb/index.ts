import NativeReverb, { IReverbParams } from "@/native/reverb";
import { errorLog } from "@/utils/log";
import PersistStatus from "@/utils/persistStatus";
import { GlobalState } from "@/utils/stateMapper";
import type { ILanguageData } from "@/types/core/i18n";

export type ReverbPresetId =
    | "studio"
    | "concert"
    | "hall"
    | "theater"
    | "ktv"
    | "room";

export interface IReverbPreset {
    id: ReverbPresetId;
    i18nKey: keyof ILanguageData;
    /** 强度为 100% 时的参数 */
    params: IReverbParams;
}

/** 湿声最小电平（听感上等同关闭） */
const WET_MIN_LEVEL = -9000;

const presets: IReverbPreset[] = [
    {
        id: "studio",
        i18nKey: "panel.reverb.preset.studio",
        params: {
            roomLevel: -900,
            roomHFLevel: -600,
            decayTime: 260,
            decayHFRatio: 780,
            reflectionsLevel: -1100,
            reflectionsDelay: 8,
            reverbLevel: -150,
            reverbDelay: 10,
            diffusion: 780,
            density: 900,
        },
    },
    {
        id: "concert",
        i18nKey: "panel.reverb.preset.concert",
        params: {
            roomLevel: 0,
            roomHFLevel: -700,
            decayTime: 2800,
            decayHFRatio: 480,
            reflectionsLevel: -300,
            reflectionsDelay: 32,
            reverbLevel: 800,
            reverbDelay: 45,
            diffusion: 900,
            density: 720,
        },
    },
    {
        id: "hall",
        i18nKey: "panel.reverb.preset.hall",
        params: {
            roomLevel: -200,
            roomHFLevel: -550,
            decayTime: 1900,
            decayHFRatio: 460,
            reflectionsLevel: -500,
            reflectionsDelay: 24,
            reverbLevel: 500,
            reverbDelay: 36,
            diffusion: 860,
            density: 760,
        },
    },
    {
        id: "theater",
        i18nKey: "panel.reverb.preset.theater",
        params: {
            roomLevel: -400,
            roomHFLevel: -800,
            decayTime: 1300,
            decayHFRatio: 600,
            reflectionsLevel: -700,
            reflectionsDelay: 18,
            reverbLevel: 250,
            reverbDelay: 28,
            diffusion: 820,
            density: 800,
        },
    },
    {
        id: "ktv",
        i18nKey: "panel.reverb.preset.ktv",
        params: {
            roomLevel: -600,
            roomHFLevel: -400,
            decayTime: 720,
            decayHFRatio: 900,
            reflectionsLevel: -900,
            reflectionsDelay: 10,
            reverbLevel: 150,
            reverbDelay: 18,
            diffusion: 700,
            density: 920,
        },
    },
    {
        id: "room",
        i18nKey: "panel.reverb.preset.room",
        params: {
            roomLevel: -1500,
            roomHFLevel: -900,
            decayTime: 420,
            decayHFRatio: 800,
            reflectionsLevel: -1600,
            reflectionsDelay: 6,
            reverbLevel: -600,
            reverbDelay: 12,
            diffusion: 700,
            density: 900,
        },
    },
];

function clamp(value: number, min: number, max: number) {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(max, Math.max(min, value));
}

/** 把「最小电平 ~ 预设电平」按强度线性插值 */
function mixLevel(base: number, ratio: number) {
    return Math.round(WET_MIN_LEVEL + (base - WET_MIN_LEVEL) * ratio);
}

export function getReverbPresets() {
    return presets;
}

export function getReverbPreset(id?: string) {
    return presets.find(_ => _.id === id) ?? presets[0];
}

export function buildReverbParams(
    presetId: string,
    intensity: number,
): IReverbParams {
    const preset = getReverbPreset(presetId);
    const ratio = clamp(intensity, 0, 100) / 100;

    return {
        ...preset.params,
        roomLevel: mixLevel(preset.params.roomLevel, ratio),
        reflectionsLevel: mixLevel(preset.params.reflectionsLevel, ratio),
        reverbLevel: mixLevel(preset.params.reverbLevel, ratio),
    };
}

const enabledStore = new GlobalState<boolean>(
    PersistStatus.get("audio.reverbEnabled") ?? false,
);
const presetStore = new GlobalState<string>(
    getReverbPreset(PersistStatus.get("audio.reverbPreset") ?? undefined).id,
);
const intensityStore = new GlobalState<number>(
    clamp(PersistStatus.get("audio.reverbIntensity") ?? 60, 0, 100),
);
/** 设备/系统是否真的支持混响 */
const supportedStore = new GlobalState<boolean>(!!NativeReverb);

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
        supportedStore.setValue(!!status.supported);
    } catch {
        supportedStore.setValue(false);
    }
}

/** 原生侧挂载是异步 + 需要重试的，隔一段时间再确认状态 */
function scheduleStatusRefresh() {
    clearStatusTimers();
    [600, 1800, 4000, 8000].forEach(delay => {
        statusTimers.push(
            setTimeout(() => {
                refreshStatus();
            }, delay),
        );
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
            buildReverbParams(presetStore.getValue(), intensityStore.getValue()),
        );
        if (!enabled) {
            supportedStore.setValue(true);
        } else if (status.supported) {
            supportedStore.setValue(true);
        }
        // 开启时原生可能还在等播放器创建 session，稍后再刷新
        scheduleStatusRefresh();
    } catch (e: any) {
        errorLog("混响参数应用失败", e?.message);
        supportedStore.setValue(false);
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

/** 播放器初始化完成后，把上次保存的混响状态恢复回去 */
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

/** 切歌/开始播放时重新确认一次（session 可能在播放后才生成） */
export function reapplyReverb() {
    if (!NativeReverb || !enabledStore.getValue()) {
        return;
    }
    schedulePush(200);
}
