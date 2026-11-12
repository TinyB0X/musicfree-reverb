import NativeReverb, {
    INativeReverbStatus,
    IReverbParams,
} from "@/native/reverb";
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

/** 强度 0% 时各电平压到多低（mB），保证听感接近「关闭」但不至于完全没声 */
const WET_FLOOR_LEVEL = -2000;
const ROOM_FLOOR_LEVEL = -1200;
const REFLECTION_FLOOR_LEVEL = -2500;

const presets: IReverbPreset[] = [
    {
        id: "studio",
        i18nKey: "panel.reverb.preset.studio",
        params: {
            roomLevel: -150,
            roomHFLevel: -600,
            decayTime: 200,
            decayHFRatio: 700,
            reflectionsLevel: -600,
            reflectionsDelay: 8,
            reverbLevel: 100,
            reverbDelay: 10,
            diffusion: 800,
            density: 900,
        },
    },
    {
        id: "concert",
        i18nKey: "panel.reverb.preset.concert",
        params: {
            roomLevel: 0,
            roomHFLevel: -400,
            decayTime: 3000,
            decayHFRatio: 500,
            reflectionsLevel: -100,
            reflectionsDelay: 40,
            reverbLevel: 1000,
            reverbDelay: 60,
            diffusion: 900,
            density: 700,
        },
    },
    {
        id: "hall",
        i18nKey: "panel.reverb.preset.hall",
        params: {
            roomLevel: 0,
            roomHFLevel: -300,
            decayTime: 2000,
            decayHFRatio: 480,
            reflectionsLevel: -150,
            reflectionsDelay: 30,
            reverbLevel: 700,
            reverbDelay: 45,
            diffusion: 860,
            density: 750,
        },
    },
    {
        id: "theater",
        i18nKey: "panel.reverb.preset.theater",
        params: {
            roomLevel: -100,
            roomHFLevel: -500,
            decayTime: 1500,
            decayHFRatio: 600,
            reflectionsLevel: -300,
            reflectionsDelay: 20,
            reverbLevel: 450,
            reverbDelay: 30,
            diffusion: 820,
            density: 800,
        },
    },
    {
        id: "ktv",
        i18nKey: "panel.reverb.preset.ktv",
        params: {
            roomLevel: -150,
            roomHFLevel: -250,
            decayTime: 900,
            decayHFRatio: 900,
            reflectionsLevel: -500,
            reflectionsDelay: 10,
            reverbLevel: 350,
            reverbDelay: 20,
            diffusion: 700,
            density: 920,
        },
    },
    {
        id: "room",
        i18nKey: "panel.reverb.preset.room",
        params: {
            roomLevel: -600,
            roomHFLevel: -700,
            decayTime: 500,
            decayHFRatio: 800,
            reflectionsLevel: -800,
            reflectionsDelay: 6,
            reverbLevel: 0,
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

/** 按强度在「底板电平 ~ 预设电平」之间插值（强度越高湿声越明显） */
function mixLevel(base: number, ratio: number, floor: number) {
    return Math.round(base * ratio + floor * (1 - ratio));
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
        roomLevel: mixLevel(preset.params.roomLevel, ratio, ROOM_FLOOR_LEVEL),
        reflectionsLevel: mixLevel(
            preset.params.reflectionsLevel,
            ratio,
            REFLECTION_FLOOR_LEVEL,
        ),
        reverbLevel: mixLevel(preset.params.reverbLevel, ratio, WET_FLOOR_LEVEL),
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
/** 原生侧最近一次状态（用于面板展示诊断信息） */
const statusStore = new GlobalState<INativeReverbStatus | null>(null);

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
        // 只有真正挂上效果器、或者已经彻底重试失败，才更新「是否支持」
        if (status.supported) {
            supportedStore.setValue(true);
        } else if (status.gaveUp) {
            supportedStore.setValue(false);
        }
    } catch {
        // 原生模块异常，保留上一次状态
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
            presetStore.getValue(),
            intensityStore.getValue(),
        );
        statusStore.setValue(status);
        if (!enabled || status.supported) {
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
