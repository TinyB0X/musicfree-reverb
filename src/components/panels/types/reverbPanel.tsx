import React from "react";
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
    setReverbEnabled,
    setReverbIntensity,
    setReverbPreset,
    useReverbEnabled,
    useReverbIntensity,
    useReverbPreset,
    useReverbSupported,
} from "@/core/reverb";

/** 「原声」卡片的伪 id */
const EMPTY_PRESET = "none";

export default function ReverbPanel() {
    const i18n = useI18N();
    const colors = useColors();
    const safeAreaInsets = useSafeAreaInsets();

    const enabled = useReverbEnabled();
    const presetId = useReverbPreset();
    const intensity = useReverbIntensity();
    const supported = useReverbSupported();

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

    return (
        <PanelBase
            height={rpx(820)}
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
                            <ThemeText
                                fontSize="subTitle"
                                fontWeight="semibold">
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

                        <ThemeText
                            style={styles.tip}
                            fontSize="description"
                            fontColor="textSecondary">
                            {i18n.t("panel.reverb.tip")}
                        </ThemeText>

                        {enabled && !supported ? (
                            <ThemeText
                                style={styles.unsupported}
                                fontSize="description"
                                color={colors.danger}>
                                {i18n.t("panel.reverb.unsupported")}
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
        marginTop: rpx(24),
        marginBottom: rpx(4),
    },
    slider: {
        width: "100%",
        height: rpx(72),
    },
    tip: {
        marginTop: rpx(8),
        lineHeight: rpx(34),
    },
    unsupported: {
        marginTop: rpx(12),
    },
});
