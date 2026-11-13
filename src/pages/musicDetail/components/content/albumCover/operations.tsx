import React, { useMemo } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import rpx from "@/utils/rpx";

import LocalMusicSheet from "@/core/localMusicSheet";
import { ROUTE_PATH } from "@/core/router";
import { ImgAsset } from "@/constants/assetsConst";
import Toast from "@/utils/toast";
import toast from "@/utils/toast";
import { showPanel } from "@/components/panels/usePanel";
import TrackPlayer, { useCurrentMusic, useMusicQuality } from "@/core/trackPlayer";
import { iconSizeConst } from "@/constants/uiConst";
import PersistStatus from "@/utils/persistStatus";
import HeartIcon from "../heartIcon";
import Icon from "@/components/base/icon.tsx";
import PluginManager from "@/core/pluginManager";
import downloader from "@/core/downloader";
import i18n from "@/core/i18n";

function ActionItem(props: {
    label: string;
    onPress?: () => void;
    children: React.ReactNode;
}) {
    return (
        <Pressable style={styles.item} onPress={props.onPress}>
            <View style={styles.itemIcon}>{props.children}</View>
            <Text style={styles.itemLabel} numberOfLines={1}>
                {props.label}
            </Text>
        </Pressable>
    );
}

export default function Operations() {
    const musicItem = useCurrentMusic();
    const currentQuality = useMusicQuality();
    const isDownloaded = LocalMusicSheet.useIsLocal(musicItem);
    const rate = PersistStatus.useValue("music.rate", 100);

    const supportComment = useMemo(() => {
        return !musicItem
            ? false
            : !!PluginManager.getByMedia(musicItem)?.supportedMethods.has(
                  "getMusicComments",
              );
    }, [musicItem]);

    return (
        <View style={styles.wrapper}>
            <ActionItem label={i18n.t("musicDetail.action.favorite")}>
                <HeartIcon />
            </ActionItem>

            <ActionItem
                label={i18n.t("musicDetail.action.download")}
                onPress={() => {
                    if (musicItem && !isDownloaded) {
                        showPanel("MusicQuality", {
                            type: "download",
                            musicItem,
                            async onQualityPress(quality) {
                                downloader.download(musicItem, quality);
                            },
                        });
                    }
                }}>
                <Icon
                    name={isDownloaded ? "check-circle-outline" : "arrow-down-tray"}
                    size={iconSizeConst.normal}
                    color="white"
                />
            </ActionItem>

            <ActionItem
                label={i18n.t("musicDetail.action.comment")}
                onPress={() => {
                    if (!supportComment) {
                        toast.warn(
                            i18n.t("toast.commmentNotAvaliableForCurrentMusic"),
                        );
                        return;
                    }
                    if (musicItem) {
                        showPanel("MusicComment", { musicItem });
                    }
                }}>
                <Icon
                    name="chat-bubble-oval-left-ellipsis"
                    size={iconSizeConst.normal}
                    color="white"
                    opacity={supportComment ? 1 : 0.25}
                />
            </ActionItem>

            <ActionItem
                label={i18n.t("musicDetail.action.quality")}
                onPress={() => {
                    if (!musicItem) {
                        return;
                    }
                    showPanel("MusicQuality", {
                        musicItem,
                        async onQualityPress(quality) {
                            const changeResult =
                                await TrackPlayer.changeQuality(quality);
                            if (!changeResult) {
                                Toast.warn(
                                    i18n.t(
                                        "toast.currentQualityNotAvailableForCurrentMusic",
                                    ),
                                );
                            }
                        },
                    });
                }}>
                <Image source={ImgAsset.quality[currentQuality]} style={styles.quality} />
            </ActionItem>

            {Platform.OS === "android" ? (
                <ActionItem
                    label={i18n.t("musicDetail.action.sound")}
                    onPress={() => {
                        showPanel("Reverb");
                    }}>
                    <Icon
                        name="speaker-wave"
                        size={iconSizeConst.normal}
                        color="white"
                    />
                </ActionItem>
            ) : null}

            <ActionItem
                label={i18n.t("musicDetail.action.more")}
                onPress={() => {
                    if (musicItem) {
                        showPanel("MusicItemOptions", {
                            musicItem,
                            from: ROUTE_PATH.MUSIC_DETAIL,
                        });
                    }
                }}>
                <Icon
                    name="ellipsis-vertical"
                    size={iconSizeConst.normal}
                    color="white"
                />
            </ActionItem>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        height: rpx(112),
        marginTop: rpx(20),
        marginBottom: rpx(8),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    item: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    itemIcon: {
        height: rpx(52),
        alignItems: "center",
        justifyContent: "center",
    },
    itemLabel: {
        marginTop: rpx(8),
        color: "rgba(255,255,255,0.6)",
        fontSize: rpx(22),
        includeFontPadding: false,
    },
    quality: {
        width: rpx(46),
        height: rpx(46),
    },
});
