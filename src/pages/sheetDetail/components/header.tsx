import FastImage from "@/components/base/fastImage";
import PlayAllBar from "@/components/base/playAllBar";
import ThemeText from "@/components/base/themeText";
import { ImgAsset } from "@/constants/assetsConst";
import { useI18N } from "@/core/i18n";
import { useSheetItem } from "@/core/musicSheet";
import { useParams } from "@/core/router";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import React from "react";
import { StyleSheet, View } from "react-native";

export default function Header() {
    const { id = "favorite" } = useParams<"local-sheet-detail">();
    const sheet = useSheetItem(id);
    const colors = useColors();
    const { t } = useI18N();

    return (
        <View style={{ backgroundColor: "transparent" }}>
            <View style={style.content}>
                <FastImage
                    style={style.coverImg}
                    source={sheet?.coverImg}
                    placeholderSource={ImgAsset.albumDefault}
                />
                <View style={style.details}>
                    <ThemeText fontSize="title" numberOfLines={3}>
                        {sheet?.title}
                    </ThemeText>
                    <ThemeText fontColor="textSecondary" fontSize="subTitle">
                        {t("sheetDetail.totalMusicCount", {
                            count: sheet?.musicList?.length ?? 0,
                        })}
                    </ThemeText>
                </View>
            </View>
            <PlayAllBar musicList={sheet?.musicList} musicSheet={sheet} />
        </View>
    );
}

const style = StyleSheet.create({
    content: {
        width: "100%",
        height: rpx(340),
        paddingHorizontal: rpx(28),
        flexDirection: "row",
        justifyContent: "flex-start",
        alignItems: "center",
    },
    coverImg: {
        width: rpx(250),
        height: rpx(250),
        borderRadius: rpx(20),
    },
    details: {
        paddingHorizontal: rpx(36),
        flex: 1,
        height: rpx(140),
        justifyContent: "space-between",
        gap: rpx(14),
    },
});
