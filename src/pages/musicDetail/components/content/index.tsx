import React from "react";
import { View } from "react-native";
import AlbumCover from "./albumCover";
import Lyric from "./lyric";
import useOrientation from "@/hooks/useOrientation";
import Config from "@/core/appConfig";
import globalStyle from "@/constants/globalStyle";
import { toggleMusicDetailTab, useMusicDetailTab } from "../../tabState";

export default function Content() {
    const tab = useMusicDetailTab();
    const orientation = useOrientation();
    const showAlbumCover =
        tab === "album" || orientation === "horizontal";

    const onTurnPageClick = () => {
        if (orientation === "horizontal") {
            return;
        }
        toggleMusicDetailTab();
    };

    return (
        <View style={globalStyle.fwflex1}>
            {showAlbumCover ? (
                <AlbumCover onTurnPageClick={onTurnPageClick} />
            ) : (
                <Lyric onTurnPageClick={onTurnPageClick} />
            )}
        </View>
    );
}
