import React from "react";
import rpx from "@/utils/rpx";
import { ImgAsset } from "@/constants/assetsConst";
import FastImage from "@/components/base/fastImage";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useCurrentMusic } from "@/core/trackPlayer";
import { StyleSheet, Text, View } from "react-native";
import Tag from "@/components/base/tag";
import Operations from "./operations";
import { showPanel } from "@/components/panels/usePanel.ts";

interface IProps {
    onTurnPageClick?: () => void;
}

export default function AlbumCover(props: IProps) {
    const { onTurnPageClick } = props;
    const musicItem = useCurrentMusic();

    const longPress = Gesture.LongPress()
        .onStart(() => {
            if (musicItem?.artwork) {
                showPanel("ImageViewer", {
                    url: musicItem.artwork,
                });
            }
        })
        .runOnJS(true);

    const tap = Gesture.Tap()
        .onStart(() => {
            onTurnPageClick?.();
        })
        .runOnJS(true);

    const combineGesture = Gesture.Race(tap, longPress);

    return (
        <View style={styles.wrapper}>
            <GestureDetector gesture={combineGesture}>
                <View style={styles.coverArea}>
                    <FastImage
                        style={styles.artwork}
                        source={musicItem?.artwork}
                        placeholderSource={ImgAsset.albumDefault}
                    />
                </View>
            </GestureDetector>
            <View style={styles.info}>
                <Text numberOfLines={2} style={styles.title}>
                    {musicItem?.title ?? "--"}
                </Text>
                {musicItem?.platform ? (
                    <View style={styles.tagRow}>
                        <Tag
                            tagName={musicItem.platform}
                            containerStyle={styles.tagBg}
                            style={styles.tagText}
                        />
                    </View>
                ) : null}
            </View>
            <Operations />
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        flex: 1,
        paddingHorizontal: rpx(40),
    },
    coverArea: {
        flex: 1,
        justifyContent: "center",
    },
    artwork: {
        width: "100%",
        aspectRatio: 1,
        borderRadius: rpx(24),
        backgroundColor: "rgba(255,255,255,0.06)",
    },
    info: {
        marginTop: rpx(28),
    },
    title: {
        color: "white",
        fontSize: rpx(48),
        fontWeight: "600",
        lineHeight: rpx(62),
        includeFontPadding: false,
    },
    tagRow: {
        marginTop: rpx(14),
        flexDirection: "row",
    },
    tagBg: {
        backgroundColor: "rgba(255,255,255,0.12)",
        borderRadius: rpx(8),
    },
    tagText: {
        color: "rgba(255,255,255,0.75)",
        fontSize: rpx(22),
    },
});
