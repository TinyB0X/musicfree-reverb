import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import Slider from "@react-native-community/slider";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
import ThemeText from "@/components/base/themeText";
import ThemeSwitch from "@/components/base/switch";
import useColors from "@/hooks/useColors";
import { useI18N } from "@/core/i18n";
import rpx from "@/utils/rpx";
import {
    getReverbPresets,
    resetReverbAdvanced,
    setEqTest,
    setReverbAdvanced,
    setReverbEnabled,
    setReverbIntensity,
    setReverbPreset,
    useReverbAdvanced,
    useReverbEnabled,
    useReverbIntensity,
    useReverbPreset,
    useReverbStatus,
} from "@/core/reverb";

/** 「原声」卡片的伪 id */
const EMPTY_PRESET = "none";

interface IParamSliderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    disabled?: boolean;
    onValueChange: (value: number) => void;
}

function ParamSlider(props: IParamSliderProps) {
    const { label, value, min, max, step = 1, unit = "", disabled, onValueChange } = props;
    const colors = useColors();

    return (
        <View style={styles.paramBlock}>
            <View style={styles.paramHeader}>
                <ThemeText fontSize="description" fontColor="textSecondary">
                    {label}
                </ThemeText>
                <ThemeText fontSize="description" fontColor="textSecondary">
                    {Math.round(value)}{unit}
                </ThemeText>
            </View>
            <Slider
                style={styles.paramSlider}
                minimumValue={min}
                maximumValue={max}
                step={step}
                value={value}
                disabled={disabled}
                thumbTintColor={colors.primary}
                minimumTrackTintColor={colors.primary}
                maximumTrackTintColor={colors.placeholder}
                onValueChange={onValueChange}
            />
        </View>
    );
}

export default function ReverbPanel() {
    const i18n = useI18N();
    const colors = useColors();
    const safeAreaInsets = useSafeAreaInsets();

    const enabled = useReverbEnabled();
    const presetId = useReverbPreset();
    const intensity = useReverbIntensity();
    const status = useReverbStatus();
    const advanced = useReverbAdvanced();

    const [showAdvanced, setShowAdvanced] = useState(false);

    const activePreset = enabled ? presetId : EMPTY_PRESET;

    const cards = [
        {
            id: EMPTY_PRESET,
            label: i18n.t("panel.reverb.preset.none"),
        },
        ...getReverbPresets().map(_ => ({
            id: _.id as string,
            label: i18n.t(_.i18nKey),
        })),
    ];

    const updateAdvanced = (patch: Record<string, number>) => {
        setReverbAdvanced({
            ...advanced,
            ...patch,
        });
    };

    return (
        <PanelBase
            height={rpx(900)}
            keyboardAvoidBehavior="none"
            renderBody={() => (
                <>
                    <PanelHeader
                        title={i18n.t("panel.reverb.title")}
                        hideButtons
                    />
                    <ScrollView
                        style={styles.body}
                        contentContainerStyle={{
                            paddingBottom: safeAreaInsets.bottom + rpx(32),
                        }}>
                        <View style={styles.switchRow}>
                            <ThemeText fontSize="subTitle">
                                {i18n.t("panel.reverb.enable")}
                            </ThemeText>
                            <ThemeSwitch
                                value={enabled}
                                onValueChange={value => {
                                    setReverbEnabled(!!value);
                                }}
                            />
                        </View>

                        <ThemeText
                            style={styles.sectionTitle}
                            fontSize="subTitle"
                            fontWeight="semibold">
                            {i18n.t("panel.reverb.preset")}
                        </ThemeText>

                        <View style={styles.presetWrapper}>
                            {cards.map(card => {
                                const active = activePreset === card.id;
                                return (
                                    <Pressable
                                        key={card.id}
                                        style={[
                                            styles.presetCard,
                                            {
                                                backgroundColor: active
                                                    ? colors.primary
                                                    : colors.card,
                                            },
                                        ]}
                                        onPress={() => {
                                            if (card.id === EMPTY_PRESET) {
                                                setReverbEnabled(false);
                                            } else {
                                                setReverbPreset(card.id);
                                            }
                                        }}>
                                        <ThemeText
                                            numberOfLines={1}
                                            color={
                                                active ? "white" : undefined
                                            }
                                            fontSize="content"
                                            fontWeight={
                                                active ? "medium" : "regular"
                                            }>
                                            {card.label}
                                        </ThemeText>
                                    </Pressable>
                                );
                            })}
                        </View>

                        <View style={styles.intensityHeader}>
                            <ThemeText fontSize="subTitle" fontWeight="semibold">
                                {i18n.t("panel.reverb.intensity")}
                            </ThemeText>
                            <ThemeText
                                fontSize="subTitle"
                                fontColor="textSecondary">
                                {intensity}%
                            </ThemeText>
                        </View>

                        <Slider
                            style={styles.slider}
                            minimumValue={0}
                            maximumValue={100}
                            step={1}
                            value={intensity}
                            disabled={!enabled}
                            thumbTintColor={colors.primary}
                            minimumTrackTintColor={colors.primary}
                            maximumTrackTintColor={colors.placeholder}
                            onValueChange={value => {
                                setReverbIntensity(value);
                            }}
                        />

                        <Pressable
                            style={styles.advancedHeader}
                            onPress={() => setShowAdvanced(v => !v)}>
                            <ThemeText fontSize="subTitle" fontWeight="semibold">
                                {i18n.t("panel.reverb.advanced")}
                                {showAdvanced ? "  ▾" : "  ▸"}
                            </ThemeText>
                            <ThemeText
                                fontSize="description"
                                fontColor="textHighlight"
                                onPress={() => resetReverbAdvanced()}>
                                {i18n.t("panel.reverb.advanced.reset")}
                            </ThemeText>
                        </Pressable>

                        {showAdvanced ? (
                            <View style={styles.advancedBody}>
                                <ParamSlider
                                    label={i18n.t("panel.reverb.advanced.wet")}
                                    value={advanced.wet ?? 50}
                                    min={0}
                                    max={100}
                                    unit="%"
                                    disabled={!enabled}
                                    onValueChange={v => updateAdvanced({ wet: v })}
                                />
                                <ParamSlider
                                    label={i18n.t("panel.reverb.advanced.decay")}
                                    value={advanced.decay ?? 2000}
                                    min={100}
                                    max={8000}
                                    step={50}
                                    unit="ms"
                                    disabled={!enabled}
                                    onValueChange={v => updateAdvanced({ decay: v })}
                                />
                                <ParamSlider
                                    label={i18n.t("panel.reverb.advanced.damping")}
                                    value={advanced.damping ?? 30}
                                    min={0}
                                    max={100}
                                    unit="%"
                                    disabled={!enabled}
                                    onValueChange={v => updateAdvanced({ damping: v })}
                                />
                                <ParamSlider
                                    label={i18n.t("panel.reverb.advanced.preDelay")}
                                    value={advanced.preDelay ?? 20}
                                    min={0}
                                    max={200}
                                    unit="ms"
                                    disabled={!enabled}
                                    onValueChange={v => updateAdvanced({ preDelay: v })}
                                />
                            </View>
                        ) : null}

                        <View style={styles.eqRow}>
                            <ThemeText fontSize="description">
                                {i18n.t("panel.reverb.eqTest")}
                            </ThemeText>
                            <ThemeSwitch
                                value={!!status?.eqTesting}
                                onValueChange={value => {
                                    setEqTest(!!value);
                                }}
                            />
                        </View>

                        <ThemeText
                            style={styles.tip}
                            fontSize="description"
                            fontColor="textSecondary">
                            {i18n.t("panel.reverb.tip")}
                        </ThemeText>

                        {enabled && status?.dspInstalled ? (
                            <ThemeText
                                style={styles.unsupported}
                                fontSize="description"
                                fontColor="textSecondary">
                                {i18n.t("panel.reverb.status.dsp")}
                            </ThemeText>
                        ) : null}
                        {enabled && status?.supported && !status?.dspInstalled ? (
                            <ThemeText
                                style={styles.unsupported}
                                fontSize="description"
                                fontColor="textSecondary">
                                {!status.hasControl
                                    ? i18n.t("panel.reverb.status.noControl")
                                    : status.effectKind === "environmental"
                                        ? i18n.t("panel.reverb.status.env")
                                        : i18n.t("panel.reverb.status.preset")}
                            </ThemeText>
                        ) : null}
                        {!status?.dspInstalled && status?.dspError && enabled ? (
                            <ThemeText
                                style={styles.unsupported}
                                fontSize="description"
                                color={colors.danger}>
                                {i18n.t("panel.reverb.status.dspFailed", {
                                    reason: status.dspError,
                                })}
                            </ThemeText>
                        ) : null}
                        {enabled && !status?.supported && status?.gaveUp ? (
                            <ThemeText
                                style={styles.unsupported}
                                fontSize="description"
                                color={colors.danger}>
                                {i18n.t("panel.reverb.failed", {
                                    reason:
                                        status?.error ||
                                        i18n.t("panel.reverb.unsupported"),
                                })}
                            </ThemeText>
                        ) : null}
                        {status ? (
                            <ThemeText
                                style={styles.unsupported}
                                fontSize="description"
                                fontColor="textSecondary">
                                {i18n.t("panel.reverb.session", {
                                    id: String(status.liveSessionId),
                                })}
                                {status.eqTesting
                                    ? "  ·  EQ " +
                                      (status.eqHasControl ? "OK" : "NO-CTRL")
                                    : ""}
                            </ThemeText>
                        ) : null}
                    </ScrollView>
                </>
            )}
        />
    );
}

const styles = StyleSheet.create({
    body: {
        flex: 1,
        width: "100%",
        paddingHorizontal: rpx(24),
    },
    switchRow: {
        width: "100%",
        height: rpx(96),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    sectionTitle: {
        marginTop: rpx(8),
        marginBottom: rpx(20),
    },
    presetWrapper: {
        width: "100%",
        flexDirection: "row",
        flexWrap: "wrap",
        gap: rpx(12),
        marginBottom: rpx(16),
    },
    presetCard: {
        width: "23%",
        height: rpx(88),
        borderRadius: rpx(12),
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: rpx(4),
    },
    intensityHeader: {
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: rpx(16),
        marginBottom: rpx(4),
    },
    slider: {
        width: "100%",
        height: rpx(72),
    },
    advancedHeader: {
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: rpx(12),
        height: rpx(72),
    },
    advancedBody: {
        width: "100%",
    },
    paramBlock: {
        width: "100%",
    },
    paramHeader: {
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: rpx(8),
    },
    paramSlider: {
        width: "100%",
        height: rpx(60),
    },
    eqRow: {
        width: "100%",
        height: rpx(80),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: rpx(12),
    },
    tip: {
        marginTop: rpx(4),
        lineHeight: rpx(34),
    },
    unsupported: {
        marginTop: rpx(10),
    },
});
