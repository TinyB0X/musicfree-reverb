import { useI18N } from "@/core/i18n";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { useCurrentMusic } from "@/core/trackPlayer";
import rpx from "@/utils/rpx";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Icon, { IIconName } from "@/components/base/icon.tsx";
import useColors from "@/hooks/useColors";
import Color from "color";

function IconBox(props: { name: IIconName }) {
    return (
        <View style={styles.iconBox}>
            <Icon name={props.name} size={rpx(40)} color="#E8542B" />
        </View>
    );
}

export default function Operations() {
    const navigate = useNavigate();
    const { t } = useI18N();
    const colors = useColors();
    const musicItem = useCurrentMusic();

    const cards = [
        {
            iconName: "folder-music-outline",
            title: t("home.localMusic"),
            action() {
                navigate(ROUTE_PATH.LOCAL);
            },
        },
        {
            iconName: "arrow-down-tray",
            title: t("home.downloading"),
            action() {
                navigate(ROUTE_PATH.DOWNLOADING);
            },
        },
        {
            iconName: "trophy",
            title: t("home.topList"),
            action() {
                navigate(ROUTE_PATH.TOP_LIST);
            },
        },
        {
            iconName: "fire",
            title: t("home.recommendSheet"),
            action() {
                navigate(ROUTE_PATH.RECOMMEND_SHEETS);
            },
        },
    ] as const;

    const cardColor = Color(colors.card).alpha(1).toString();

    return (
        <View style={styles.container}>
            <Pressable
                style={[styles.recentCard, { backgroundColor: cardColor }]}
                onPress={() => {
                    navigate(ROUTE_PATH.HISTORY);
                }}>
                <IconBox name="clock-outline" />
                <View style={styles.recentTextWrapper}>
                    <Text style={styles.recentTitle}>
                        {t("home.recentPlay") || "最近播放"}
                    </Text>
                    <Text numberOfLines={1} style={styles.recentSubtitle}>
                        {musicItem
                            ? `${musicItem.title} - ${musicItem.artist ?? ""}`
                            : t("home.recentPlayEmpty") || "暂无播放记录"}
                    </Text>
                </View>

            </Pressable>

            <View style={styles.grid}>
                {cards.map((item, index) => (
                    <Pressable
                        key={item.title}
                        style={[
                            styles.card,
                            { backgroundColor: cardColor },
                            index % 2 === 1 ? styles.cardRight : null,
                        ]}
                        onPress={item.action}>
                        <IconBox name={item.iconName} />
                        <Text style={styles.cardTitle} numberOfLines={1}>
                            {item.title}
                        </Text>
                    </Pressable>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: "100%",
        paddingHorizontal: rpx(24),
        marginTop: rpx(12),
        marginBottom: rpx(20),
    },
    recentCard: {
        width: "100%",
        height: rpx(120),
        borderRadius: rpx(18),
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: rpx(20),
    },
    recentTextWrapper: {
        flex: 1,
        marginLeft: rpx(18),
    },
    recentTitle: {
        color: "rgba(255,255,255,0.92)",
        fontSize: rpx(30),
        includeFontPadding: false,
    },
    recentSubtitle: {
        marginTop: rpx(8),
        color: "rgba(255,255,255,0.45)",
        fontSize: rpx(24),
        includeFontPadding: false,
    },
    grid: {
        marginTop: rpx(16),
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
    },
    card: {
        width: "49%",
        height: rpx(104),
        borderRadius: rpx(18),
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: rpx(16),
        marginBottom: rpx(14),
    },
    cardRight: {
        marginLeft: "2%",
    },
    cardTitle: {
        marginLeft: rpx(14),
        color: "rgba(255,255,255,0.92)",
        fontSize: rpx(28),
        includeFontPadding: false,
    },
    iconBox: {
        width: rpx(64),
        height: rpx(64),
        borderRadius: rpx(16),
        backgroundColor: "rgba(232,84,43,0.16)",
        alignItems: "center",
        justifyContent: "center",
    },
});
