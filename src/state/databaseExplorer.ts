import { atom, type Getter, type PrimitiveAtom, type SetStateAction } from "jotai";
import { atomFamily } from "jotai/utils";
import type { AtomFamily } from "jotai/vanilla/utils/atomFamily";
import type { LocalOptions } from "@/utils/db";
import type { LichessGamesOptions, MasterGamesOptions } from "@/utils/lichess/explorer";
import {
    activeTabAtom,
    lichessOptionsDefaultsAtom,
    masterOptionsDefaultsAtom,
    referenceDbAtom,
} from "./atoms";

export type DatabaseSource = "local" | "lch_all" | "lch_master";
export type DatabasePanelTab = "stats" | "games" | "options";

export function canQueryDatabaseExplorer(input: {
    initialized: boolean;
    panel: DatabasePanelTab;
    source: DatabaseSource;
    localPath: string | null;
    missingExplorerToken: boolean;
}): boolean {
    return (
        input.initialized &&
        input.panel !== "options" &&
        !input.missingExplorerToken &&
        (input.source !== "local" || Boolean(input.localPath))
    );
}

const defaultLocalOptions: LocalOptions = {
    path: null,
    type: "exact",
    fen: "",
    player: null,
    color: "white",
    result: "any",
};

const localOptionsFamily = atomFamily((_tabId: string) =>
    atom<LocalOptions>({ ...defaultLocalOptions }),
);
const lichessOptionsFamily = atomFamily((_tabId: string) =>
    atom<LichessGamesOptions>({ color: "white" }),
);
const masterOptionsFamily = atomFamily((_tabId: string) => atom<MasterGamesOptions>({}));
const dbTypeFamily = atomFamily((_tabId: string) => atom<DatabaseSource>("local"));
const dbTabFamily = atomFamily((_tabId: string) => atom<DatabasePanelTab>("stats"));
const initializedFamily = atomFamily((_tabId: string) => atom(false));

function cloneLichessOptions(options: LichessGamesOptions): LichessGamesOptions {
    return {
        ...options,
        ratings: options.ratings ? [...options.ratings] : undefined,
        speeds: options.speeds ? [...options.speeds] : undefined,
        since: options.since ? new Date(options.since.getTime()) : undefined,
        until: options.until ? new Date(options.until.getTime()) : undefined,
    };
}

function cloneMasterOptions(options: MasterGamesOptions): MasterGamesOptions {
    return {
        ...options,
        since: options.since ? new Date(options.since.getTime()) : undefined,
        until: options.until ? new Date(options.until.getTime()) : undefined,
    };
}

function requireActiveTabId(get: Getter): string {
    const tabId = get(activeTabAtom);
    if (!tabId) throw new Error("No tab selected");
    return tabId;
}

function resolveUpdate<Value>(update: SetStateAction<Value>, current: Value): Value {
    return typeof update === "function" ? (update as (value: Value) => Value)(current) : update;
}

function currentFamilyValue<Value>(family: AtomFamily<string, PrimitiveAtom<Value>>) {
    return atom(
        (get) => get(family(requireActiveTabId(get))),
        (get, set, update: SetStateAction<Value>) => {
            const valueAtom = family(requireActiveTabId(get));
            set(valueAtom, resolveUpdate(update, get(valueAtom)));
        },
    );
}

export const currentLocalOptionsAtom = currentFamilyValue(localOptionsFamily);
export const currentDbTypeAtom = currentFamilyValue(dbTypeFamily);
export const currentDbTabAtom = currentFamilyValue(dbTabFamily);
export const currentDatabaseExplorerInitializedAtom = currentFamilyValue(initializedFamily);

export const currentLichessOptionsAtom = atom(
    (get) => get(lichessOptionsFamily(requireActiveTabId(get))),
    (get, set, update: SetStateAction<LichessGamesOptions>) => {
        const valueAtom = lichessOptionsFamily(requireActiveTabId(get));
        const next = resolveUpdate(update, get(valueAtom));
        set(valueAtom, cloneLichessOptions(next));
        set(lichessOptionsDefaultsAtom, cloneLichessOptions(next));
    },
);

export const currentMasterOptionsAtom = atom(
    (get) => get(masterOptionsFamily(requireActiveTabId(get))),
    (get, set, update: SetStateAction<MasterGamesOptions>) => {
        const valueAtom = masterOptionsFamily(requireActiveTabId(get));
        const next = resolveUpdate(update, get(valueAtom));
        set(valueAtom, cloneMasterOptions(next));
        set(masterOptionsDefaultsAtom, cloneMasterOptions(next));
    },
);

export const initializeDatabaseExplorerStateAtom = atom(null, (get, set, tabId: string) => {
    if (get(initializedFamily(tabId))) return;

    const local = get(localOptionsFamily(tabId));
    set(localOptionsFamily(tabId), {
        ...local,
        path: local.path ?? get(referenceDbAtom),
    });
    set(lichessOptionsFamily(tabId), cloneLichessOptions(get(lichessOptionsDefaultsAtom)));
    set(masterOptionsFamily(tabId), cloneMasterOptions(get(masterOptionsDefaultsAtom)));
    set(initializedFamily(tabId), true);
});

export const setCurrentLocalDatabaseAtom = atom(null, (get, set, path: string | null) => {
    const optionsAtom = localOptionsFamily(requireActiveTabId(get));
    const current = get(optionsAtom);
    if (current.path === path) return;
    set(optionsAtom, { ...current, path, player: null });
});

export const syncCurrentLocalFenAtom = atom(null, (get, set, fen: string) => {
    const optionsAtom = localOptionsFamily(requireActiveTabId(get));
    const current = get(optionsAtom);
    if (current.type === "exact" && current.fen !== fen) {
        set(optionsAtom, { ...current, fen });
    }
});

function removeDatabaseExplorerState(tabId: string) {
    localOptionsFamily.remove(tabId);
    lichessOptionsFamily.remove(tabId);
    masterOptionsFamily.remove(tabId);
    dbTypeFamily.remove(tabId);
    dbTabFamily.remove(tabId);
    initializedFamily.remove(tabId);
}

export const removeDatabaseExplorerStateAtom = atom(null, (_get, _set, tabId: string) => {
    removeDatabaseExplorerState(tabId);
});

export const copyDatabaseExplorerStateAtom = atom(
    null,
    (get, set, ids: { sourceTabId: string; targetTabId: string }) => {
        removeDatabaseExplorerState(ids.targetTabId);
        if (!get(initializedFamily(ids.sourceTabId))) return;

        set(localOptionsFamily(ids.targetTabId), { ...get(localOptionsFamily(ids.sourceTabId)) });
        set(
            lichessOptionsFamily(ids.targetTabId),
            cloneLichessOptions(get(lichessOptionsFamily(ids.sourceTabId))),
        );
        set(
            masterOptionsFamily(ids.targetTabId),
            cloneMasterOptions(get(masterOptionsFamily(ids.sourceTabId))),
        );
        set(dbTypeFamily(ids.targetTabId), get(dbTypeFamily(ids.sourceTabId)));
        set(dbTabFamily(ids.targetTabId), get(dbTabFamily(ids.sourceTabId)));
        set(initializedFamily(ids.targetTabId), true);
    },
);
