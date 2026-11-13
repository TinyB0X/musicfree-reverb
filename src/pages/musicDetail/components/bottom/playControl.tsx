import repeatModeConst from "@/constants/repeatModeConst";
import rpx from "@/utils/rpx";
import React from "react";
import { InteractionManager, Pressable, StyleSheet, View } from "react-native";

import Icon from "@/components/base/icon.tsx";
import { showPanel } from "@/components/panels/usePanel";
import TrackPlayer, { useMusicState, useRepeatMode } from "@/core/trackPlayer";
import useOrientation from "@/hooks/useOrientation";
import delay from "@/utils/delay";
import { musicIsPaused } from "@/utils/trackUtils";

export default function () {
    const repeatMode = useRepeatMode();
    const musicState = useMusicState();
    const orientation = useOrientation();

    return (
        <View
            style={[
                style.wrapper,
                orientation === "horizontal" ? { marginTop: 0 } : null,
            ]}>
            <Icon
                color={"white"}
                name={repeatModeConst[repeatMode].icon}
                size={rpx(48)}
                onPress={async () => {
                    InteractionManager.runAfterInteractions(async () => {
                        await delay(20, false);
                        TrackPlayer.toggleRepeatMode();
                    });
                }}
            />
            <Icon
                color={"white"}
                name={"skip-left"}
                size={rpx(56)}
                onPress={() => {
                    TrackPlayer.skipToPrevious();
                }}
            />
            <Pressable
                style={style.playButton}
                onPress={() => {
                    if (musicIsPaused(musicState)) {
                        TrackPlayer.play();
                    } else {
                        TrackPlayer.pause();
                    }
                }}>
                <Icon
                    color={"white"}
                    name={musicIsPaused(musicState) ? "play" : "pause"}
                    size={rpx(48)}
                />
            </Pressable>
            <Icon
                color={"white"}
                name={"skip-right"}
                size={rpx(56)}
                onPress={() => {
                    TrackPlayer.skipToNext();
                }}
            />
            <Icon
                color={"white"}
                name={"playlist"}
                size={rpx(48)}
                onPress={() => {
                    showPanel("PlayList");
                }}
            />
        </View>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        marginTop: rpx(20),
        height: rpx(132),
        flexDirection: "row",
        justifyContent: "space-around",
        alignItems: "center",
    },
    playButton: {
        width: rpx(108),
        height: rpx(108),
        borderRadius: rpx(54),
        backgroundColor: "#E8542B",
        alignItems: "center",
        justifyContent: "center",
    },
});
