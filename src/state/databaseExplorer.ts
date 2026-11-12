import { atom, type Getter, type PrimitiveAtom, type SetStateAction } from "jotai";
import { atomFamily } from "jotai/utils";
import type { AtomFamily } from "jotai/vanilla/utils/atomFamily";
import type { LocalFilters, LocalOptions } from "@/utils/db";
import type { LichessGamesOptions, MasterGamesOptions } from "@/utils/lichess/explorer";
import { activeTabAtom, lichessOptionsDefaultsAtom, masterOptionsDefaultsAtom } from "./atoms";

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

// The filters of the active tab's Local query without its database, which only
// `setCurrentLocalDatabaseAtom` changes. Writing replaces the filters and keeps the database.
export const currentLocalFiltersAtom = atom(
    (get): LocalFilters => {
        const { path: _path, ...filters } = get(localOptionsFamily(requireActiveTabId(get)));
        return filters;
    },
    (get, set, update: SetStateAction<LocalFilters>) => {
        const optionsAtom = localOptionsFamily(requireActiveTabId(get));
        const { path, ...filters } = get(optionsAtom);
        set(optionsAtom, { ...resolveUpdate(update, filters), path });
    },
);

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

    set(lichessOptionsFamily(tabId), cloneLichessOptions(get(lichessOptionsDefaultsAtom)));
    set(masterOptionsFamily(tabId), cloneMasterOptions(get(masterOptionsDefaultsAtom)));
    set(initializedFamily(tabId), true);
});

// The global reference database is validated asynchronously, so it can arrive after a tab was
// initialized. A tab without a Local database takes it then; a tab that has one keeps its own.
export const adoptReferenceDatabaseAtom = atom(null, (get, set, referenceDb: string | null) => {
    if (!referenceDb) return;
    const optionsAtom = localOptionsFamily(requireActiveTabId(get));
    const current = get(optionsAtom);
    if (current.path === null) set(optionsAtom, { ...current, path: referenceDb });
});

export const setCurrentLocalDatabaseAtom = atom(null, (get, set, path: string | null) => {
    const optionsAtom = localOptionsFamily(requireActiveTabId(get));
    const current = get(optionsAtom);
    if (current.path === path) return;
    // Players and tournaments are names from the database being left.
    set(optionsAtom, { ...current, path, player1: null, player2: null, tournament: null });
});

// A database was deleted: no tab may keep searching it, since opening a missing path creates an
// empty database file. A tab left without one takes the reference database when it has one.
export const forgetLocalDatabaseAtom = atom(null, (get, set, path: string) => {
    for (const tabId of localOptionsFamily.getParams()) {
        const optionsAtom = localOptionsFamily(tabId);
        const current = get(optionsAtom);
        if (current.path === path) {
            set(optionsAtom, {
                ...current,
                path: null,
                player1: null,
                player2: null,
                tournament: null,
            });
        }
    }
});

// The explorer in an analysis tab always searches the exact position on the board.
export const syncCurrentLocalFenAtom = atom(null, (get, set, fen: string) => {
    const optionsAtom = localOptionsFamily(requireActiveTabId(get));
    const current = get(optionsAtom);
    if (current.position?.fen !== fen || current.position?.type_ !== "exact") {
        set(optionsAtom, { ...current, position: { fen, type_: "exact" } });
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
