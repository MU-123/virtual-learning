import "video.js/dist/video-js.css";

import type { Attributes as SlideAttributes } from "@netless/app-slide";
import { makeAutoObservable, observable, runInAction } from "mobx";
import {
    DefaultHotKeys,
    DeviceType,
    Room,
    RoomPhase,
    RoomState,
    SceneDefinition,
    ViewMode,
    ViewVisionMode,
    WhiteWebSdk,
} from "white-web-sdk";
import { CursorTool } from "@netless/cursor-tool";
import { NETLESS, NODE_ENV } from "../constants/process";
import { globalStore } from "./GlobalStore";
import { isMobile, isWindows } from "react-device-detect";
import { debounce } from "lodash-es";
import { coursewarePreloader } from "../utils/courseware-preloader";
import { WindowManager, BuiltinApps, AddAppParams } from "@netless/window-manager";
import { RoomType } from "../api-middleware/flatServer/constants";

export class WhiteboardStore {
    public room: Room | null = null;
    public phase: RoomPhase = RoomPhase.Connecting;
    public viewMode: ViewMode | null = null;
    public windowManager: WindowManager | null = null;
    public isBroadcasterMode: number | undefined = undefined;
    public isWritable: boolean;
    public isShowPreviewPanel = false;
    public isFileOpen = false;
    public isKicked = false;
    public isFocusWindow = false;
    public isWindowMaximization = false;
    public isRightSideClose = false;
    public currentSceneIndex = 0;
    public scenesCount = 0;
    public smallClassRatio = 8.3 / 16;
    public otherClassRatio = 10.46 / 16;

    /** is room Creator */
    public readonly isCreator: boolean;
    public readonly getRoomType: () => RoomType;
    public readonly isSpeaker?: boolean;

    public constructor(config: {
        isCreator: boolean;
        isSpeaker?: boolean;
        getRoomType: () => RoomType;
    }) {
        this.isCreator = config.isCreator;
        this.isWritable = config.isCreator;
        this.getRoomType = config.getRoomType;

        makeAutoObservable<this, "preloadPPTResource">(this, {
            room: observable.ref,
            preloadPPTResource: false,
        });
    }

    public updateRoom = (room: Room): void => {
        this.room = room;
    };

    public updatePhase = (phase: RoomPhase): void => {
        this.phase = phase;
    };

    public updateViewMode = (viewMode: ViewMode): void => {
        this.viewMode = viewMode;
    };

    public updateWritable = async (isWritable: boolean): Promise<void> => {
        const oldWritable = this.isWritable;

        this.isWritable = isWritable;
        if (oldWritable !== isWritable && this.room) {
            await this.room.setWritable(isWritable);
            this.room.disableDeviceInputs = !isWritable;
            if (isWritable) {
                this.room.disableSerialization = false;
            }
        }
    };

    public updateWindowManager = (windowManager: WindowManager): void => {
        this.windowManager = windowManager;
    };

    public updateCurrentSceneIndex = (currentSceneIndex: number): void => {
        this.currentSceneIndex = currentSceneIndex;
    };

    public updateScenesCount = (scenesCount: number): void => {
        this.scenesCount = scenesCount;
    };

    public updateWindowMaximization = (isMaximization: boolean): void => {
        this.isWindowMaximization = isMaximization;
    };

    public updateFocusWindow = (isFocus: boolean): void => {
        this.isFocusWindow = isFocus;
    };

    public updateBroadcasterMode = (isBroadcasterMode: number | undefined): void => {
        this.isBroadcasterMode = isBroadcasterMode;
    };

    public getWhiteboardRatio = (): number => {
        // the Ratio of whiteboard compute method is height / width.
        if (this.getRoomType() === RoomType.SmallClass) {
            return this.smallClassRatio;
        }
        return this.otherClassRatio;
    };

    public setFileOpen = (open: boolean): void => {
        this.isFileOpen = open;
    };

    public toggleFileOpen = (): void => {
        this.isFileOpen = !this.isFileOpen;
    };

    public toggleMainViewVisionMode = (mode: ViewMode): void => {
        this.windowManager?.setViewMode(mode);
        this.updateBroadcasterMode(this.windowManager?.broadcaster);
    };

    public showPreviewPanel = (): void => {
        this.isShowPreviewPanel = true;
    };

    public setPreviewPanel = (show: boolean): void => {
        this.isShowPreviewPanel = show;
    };

    public setRightSideClose = (close: boolean): void => {
        this.isRightSideClose = close;
    };

    public switchMainViewToWriter = async (): Promise<void> => {
        if (this.windowManager && this.isFocusWindow) {
            await this.windowManager.switchMainViewToWriter();
        }
    };

    public addMainViewScene = (): void => {
        if (this.room && this.windowManager) {
            const currentScene = this.currentSceneIndex + 1;
            const scenePath = this.room.state.sceneState.scenePath;
            const path = this.dirName(scenePath);

            this.room.putScenes(path, [{}], currentScene);
            this.windowManager.setMainViewSceneIndex(this.currentSceneIndex + 1);
        }
    };

    public preMainViewScene = (): void => {
        if (this.windowManager && this.currentSceneIndex > 0) {
            this.windowManager.setMainViewSceneIndex(this.currentSceneIndex - 1);
        }
    };

    public nextMainViewScene = (): void => {
        if (this.windowManager && this.currentSceneIndex < this.scenesCount - 1) {
            this.windowManager.setMainViewSceneIndex(this.currentSceneIndex + 1);
        }
    };

    public openDocsFileInWindowManager = async (
        scenePath: string,
        title: string,
        scenes: SceneDefinition[],
    ): Promise<void> => {
        if (this.windowManager) {
            const { scenesWithoutPPT, taskId, url } = this.makeSlideParams(scenes);
            try {
                if (taskId && url) {
                    await this.windowManager.addApp({
                        kind: "Slide",
                        options: {
                            scenePath,
                            title,
                            scenes: scenesWithoutPPT,
                        },
                        attributes: {
                            taskId,
                            url,
                        } as SlideAttributes,
                    });
                } else {
                    await this.windowManager.addApp({
                        kind: BuiltinApps.DocsViewer,
                        options: {
                            scenePath,
                            title,
                            scenes,
                        },
                    });
                }
            } catch (err) {
                console.log(err);
            }
        }
    };

    public openMediaFileInWindowManager = async (
        resourceSrc: string,
        title: string,
    ): Promise<void> => {
        try {
            await this.windowManager?.addApp({
                kind: BuiltinApps.MediaPlayer,
                options: {
                    title,
                },
                attributes: {
                    src: resourceSrc,
                },
            });
        } catch (err) {
            console.log(err);
        }
    };

    public addApp = async (config: AddAppParams): Promise<void> => {
        await this.windowManager?.addApp(config);
    };

    public onMainViewModeChange = (): void => {
        this.windowManager?.emitter.on("mainViewModeChange", mode => {
            const isWindow = mode !== ViewVisionMode.Writable;
            this.updateFocusWindow(isWindow);
            if (!isWindow && this.room) {
                this.updateCurrentSceneIndex(this.room.state.sceneState.index);
                this.updateScenesCount(this.room.state.sceneState.scenes.length);
            }
        });
    };

    public onWindowManagerBoxStateChange = (): void => {
        this.windowManager?.emitter.on("boxStateChange", mode => {
            const isMaximization = mode === "maximized";
            this.updateWindowMaximization(isMaximization);
        });
    };

    public destroyWindowManager = (): void => {
        this.windowManager?.destroy();
        this.windowManager = null;
    };

    public async joinWhiteboardRoom(): Promise<void> {
        if (!globalStore.userUUID) {
            throw new Error("Missing userUUID");
        }

        if (!globalStore.whiteboardRoomUUID || !globalStore.whiteboardRoomToken) {
            throw new Error("Missing Whiteboard UUID and Token");
        }

        let deviceType: DeviceType;
        if (isWindows) {
            deviceType = DeviceType.Surface;
        } else {
            if (isMobile) {
                deviceType = DeviceType.Touch;
            } else {
                deviceType = DeviceType.Desktop;
            }
        }
        const whiteWebSdk = new WhiteWebSdk({
            appIdentifier: NETLESS.APP_IDENTIFIER,
            deviceType: deviceType,
            pptParams: {
                useServerWrap: true,
            },
            useMobXState: true,
        });

        const cursorName = globalStore.userInfo?.name;
        const cursorAdapter = new CursorTool();

        const room = await whiteWebSdk.joinRoom(
            {
                uuid: globalStore.whiteboardRoomUUID,
                roomToken: globalStore.whiteboardRoomToken,
                region: globalStore.region ?? undefined,
                userPayload: {
                    userId: globalStore.userUUID,
                    cursorName,
                },
                floatBar: true,
                isWritable: this.isWritable,
                disableNewPencil: false,
                hotKeys: {
                    ...DefaultHotKeys,
                    changeToSelector: "s",
                    changeToLaserPointer: "z",
                    changeToPencil: "p",
                    changeToRectangle: "r",
                    changeToEllipse: "c",
                    changeToEraser: "e",
                    changeToText: "t",
                    changeToStraight: "l",
                    changeToArrow: "a",
                    changeToHand: "h",
                },
                useMultiViews: true,
                invisiblePlugins: [WindowManager],
                uid: globalStore.userUUID,
            },
            {
                onPhaseChanged: phase => {
                    this.updatePhase(phase);
                },
                onRoomStateChanged: async (modifyState: Partial<RoomState>): Promise<void> => {
                    if (modifyState.broadcastState) {
                        this.updateViewMode(modifyState.broadcastState.mode);
                    }

                    const pptSrc = modifyState.sceneState?.scenes[0]?.ppt?.src;
                    if (pptSrc) {
                        try {
                            await this.preloadPPTResource(pptSrc);
                        } catch (err) {
                            console.log(err);
                        }
                    }

                    if (
                        this.room &&
                        this.windowManager?.mainView.mode === ViewVisionMode.Writable
                    ) {
                        this.updateCurrentSceneIndex(this.room.state.sceneState.index);
                        this.updateScenesCount(this.room.state.sceneState.scenes.length);
                    }
                },
                onDisconnectWithError: error => {
                    console.error(error);
                    this.preloadPPTResource.cancel();
                },
                onKickedWithReason: reason => {
                    if (
                        reason === "kickByAdmin" ||
                        reason === "roomDelete" ||
                        reason === "roomBan"
                    ) {
                        // Kick in-room joiners when creator cancels room
                        // from the homepage list menu
                        runInAction(() => {
                            // Room creator do not need to listen to this event
                            // as they are in control of exiting room.
                            // Listening to this may interrupt the stop room process.
                            if (!this.isCreator) {
                                this.isKicked = true;
                            }
                        });
                    }
                },
            },
        );

        room.disableDeviceInputs = !this.isWritable;

        cursorAdapter.setRoom(room);

        if (room.state.broadcastState) {
            this.updateViewMode(room.state.broadcastState.mode);
        }

        this.updateRoom(room);

        this.updateCurrentSceneIndex(room.state.sceneState.index);

        this.updateScenesCount(room.state.sceneState.scenes.length);

        this.updateBroadcasterMode(this.windowManager?.broadcaster);

        if (this.room) {
            const windowManager = this.room.getInvisiblePlugin(WindowManager.kind) as WindowManager;
            this.updateWindowManager(windowManager);
        }

        if (NODE_ENV === "development") {
            (window as any).room = room;
            (window as any).manager = this.windowManager;
        }
    }

    public destroy(): void {
        this.preloadPPTResource.cancel();
        this.destroyWindowManager();
        this.room?.callbacks.off();

        if (NODE_ENV === "development") {
            (window as any).room = null;
            (window as any).manager = null;
        }
        console.log(`Whiteboard unloaded: ${globalStore.whiteboardRoomUUID}`);
    }

    private makeSlideParams(scenes: SceneDefinition[]): {
        scenesWithoutPPT: SceneDefinition[];
        taskId: string;
        url: string;
    } {
        const scenesWithoutPPT: SceneDefinition[] = [];
        let taskId = "";
        let url = "";

        // e.g. "ppt(x)://cdn/prefix/dynamicConvert/{taskId}/1.slide"
        const pptSrcRE = /^pptx?(?<prefix>:\/\/\S+?dynamicConvert)\/(?<taskId>\w+)\//;

        for (const { name, ppt } of scenes) {
            // make sure scenesWithoutPPT.length === scenes.length
            scenesWithoutPPT.push({ name });

            if (!ppt || !ppt.src.startsWith("ppt")) {
                continue;
            }
            const match = pptSrcRE.exec(ppt.src);
            if (!match || !match.groups) {
                continue;
            }
            taskId = match.groups.taskId;
            url = "https" + match.groups.prefix;
            break;
        }

        return { scenesWithoutPPT, taskId, url };
    }

    private preloadPPTResource = debounce(async (pptSrc: string): Promise<void> => {
        await coursewarePreloader.preload(pptSrc);
    }, 2000);

    private dirName = (scenePath: string): string => {
        return scenePath.slice(0, scenePath.lastIndexOf("/"));
    };
}