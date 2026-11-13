import { GlobalState } from "@/utils/stateMapper";

export type MusicDetailTab = "album" | "lyric";

const tabStore = new GlobalState<MusicDetailTab>("album");

export function useMusicDetailTab() {
    return tabStore.useValue();
}

export function setMusicDetailTab(tab: MusicDetailTab) {
    tabStore.setValue(tab);
}

export function toggleMusicDetailTab() {
    tabStore.setValue(tabStore.getValue() === "album" ? "lyric" : "album");
}
