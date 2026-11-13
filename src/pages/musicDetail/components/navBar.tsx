import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import rpx from "@/utils/rpx";
import { useNavigation } from "@react-navigation/native";
import { fontSizeConst } from "@/constants/uiConst";
import Share from "react-native-share";
import { B64Asset } from "@/constants/assetsConst";
import IconButton from "@/components/base/iconButton";
import i18n from "@/core/i18n";
import { setMusicDetailTab, useMusicDetailTab } from "../tabState";

function TabItem(props: { id: "album" | "lyric"; label: string }) {
    const tab = useMusicDetailTab();
    const active = tab === props.id;
    return (
        <Pressable
            style={styles.tabItem}
            onPress={() => {
                setMusicDetailTab(props.id);
            }}>
            <Text
                style={[styles.tabText, active ? styles.tabTextActive : null]}>
                {props.label}
            </Text>
            <View
                style={[
                    styles.tabIndicator,
                    active ? { opacity: 1 } : { opacity: 0 },
                ]}
            />
        </Pressable>
    );
}

export default function NavBar() {
    const navigation = useNavigation();

    return (
        <View style={styles.container}>
            <IconButton
                name="arrow-left"
                sizeType={"normal"}
                color="white"
                style={styles.button}
                onPress={() => {
                    navigation.goBack();
                }}
            />
            <View style={styles.tabs}>
                <TabItem id="album" label={i18n.t("musicDetail.tab.cover")} />
                <View style={styles.tabDivider} />
                <TabItem id="lyric" label={i18n.t("musicDetail.tab.lyric")} />
            </View>
            <IconButton
                name="share"
                color="white"
                sizeType="normal"
                style={styles.button}
                onPress={async () => {
                    try {
                        await Share.open({
                            type: "image/jpeg",
                            title: "MusicFree-一个插件化的免费音乐播放器",
                            message: "MusicFree-一个插件化的免费音乐播放器",
                            url: B64Asset.share,
                            subject: "MusicFree分享",
                        });
                    } catch {}
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: "100%",
        height: rpx(120),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    button: {
        marginHorizontal: rpx(24),
        width: rpx(80),
    },
    tabs: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
    tabItem: {
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: rpx(18),
        height: rpx(120),
    },
    tabText: {
        color: "rgba(255,255,255,0.55)",
        fontSize: fontSizeConst.title,
        includeFontPadding: false,
    },
    tabTextActive: {
        color: "white",
        fontWeight: "600",
    },
    tabIndicator: {
        marginTop: rpx(10),
        width: rpx(56),
        height: rpx(6),
        borderRadius: rpx(3),
        backgroundColor: "#E8542B",
    },
    tabDivider: {
        width: 1,
        height: rpx(28),
        marginHorizontal: rpx(4),
        backgroundColor: "rgba(255,255,255,0.35)",
    },
});
