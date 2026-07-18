import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";
import {
    activeTabAtom,
    lichessOptionsDefaultsAtom,
    masterOptionsDefaultsAtom,
    referenceDbAtom,
} from "@/state/atoms";
import {
    canQueryDatabaseExplorer,
    currentDatabaseExplorerInitializedAtom,
    currentDbTabAtom,
    currentDbTypeAtom,
    currentLichessOptionsAtom,
    currentLocalOptionsAtom,
    currentMasterOptionsAtom,
    copyDatabaseExplorerStateAtom,
    initializeDatabaseExplorerStateAtom,
    removeDatabaseExplorerStateAtom,
    setCurrentLocalDatabaseAtom,
    syncCurrentLocalFenAtom,
} from "@/state/databaseExplorer";

type TestStore = ReturnType<typeof createStore>;

const selectTab = (store: TestStore, tabId: string) => {
    store.set(activeTabAtom, tabId);
};

const initializeTab = (store: TestStore, tabId: string) => {
    store.set(initializeDatabaseExplorerStateAtom, tabId);
};

describe("database explorer tab state", () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it("keeps initialized analysis tabs independent", () => {
        const store = createStore();
        const mastersSince = new Date("2000-01-01T00:00:00.000Z");
        const mastersUntil = new Date("2020-01-01T00:00:00.000Z");

        store.set(referenceDbAtom, "/db/reference.db3");
        store.set(lichessOptionsDefaultsAtom, {
            ratings: [1000],
            speeds: ["blitz"],
            color: "white",
        });
        store.set(masterOptionsDefaultsAtom, { since: mastersSince });
        initializeTab(store, "tab-a");
        initializeTab(store, "tab-b");

        selectTab(store, "tab-a");
        store.set(setCurrentLocalDatabaseAtom, "/db/a.db3");
        store.set(currentLocalOptionsAtom, (current) => ({
            ...current,
            player: 11,
            color: "black",
        }));
        store.set(currentDbTypeAtom, "lch_all");
        store.set(currentDbTabAtom, "options");
        store.set(currentLichessOptionsAtom, {
            ratings: [2500],
            speeds: ["classical"],
            color: "black",
        });
        store.set(currentMasterOptionsAtom, (current) => ({
            ...current,
            until: mastersUntil,
        }));

        selectTab(store, "tab-b");
        expect(store.get(currentLocalOptionsAtom)).toMatchObject({
            path: "/db/reference.db3",
            player: null,
            color: "white",
        });
        expect(store.get(currentDbTypeAtom)).toBe("local");
        expect(store.get(currentDbTabAtom)).toBe("stats");
        expect(store.get(currentLichessOptionsAtom)).toEqual({
            ratings: [1000],
            speeds: ["blitz"],
            color: "white",
        });
        expect(store.get(currentMasterOptionsAtom)).toEqual({ since: mastersSince });
        expect(store.get(referenceDbAtom)).toBe("/db/reference.db3");
        expect(store.get(lichessOptionsDefaultsAtom)).toEqual({
            ratings: [2500],
            speeds: ["classical"],
            color: "black",
        });
        expect(store.get(masterOptionsDefaultsAtom)).toEqual({
            since: mastersSince,
            until: mastersUntil,
        });
    });

    it("uses changed defaults only for tabs initialized later", () => {
        const store = createStore();
        const originalSince = new Date("2001-01-01T00:00:00.000Z");
        const futureSince = new Date("2015-01-01T00:00:00.000Z");

        store.set(referenceDbAtom, "/db/a.db3");
        store.set(lichessOptionsDefaultsAtom, { ratings: [1400], color: "white" });
        store.set(masterOptionsDefaultsAtom, { since: originalSince });
        initializeTab(store, "tab-a");

        store.set(referenceDbAtom, "/db/b.db3");
        store.set(lichessOptionsDefaultsAtom, { ratings: [2200], color: "black" });
        store.set(masterOptionsDefaultsAtom, { since: futureSince });
        initializeTab(store, "tab-c");

        selectTab(store, "tab-a");
        expect(store.get(currentLocalOptionsAtom).path).toBe("/db/a.db3");
        expect(store.get(currentLichessOptionsAtom)).toEqual({
            ratings: [1400],
            color: "white",
        });
        expect(store.get(currentMasterOptionsAtom)).toEqual({ since: originalSince });

        selectTab(store, "tab-c");
        expect(store.get(currentLocalOptionsAtom).path).toBe("/db/b.db3");
        expect(store.get(currentLichessOptionsAtom)).toEqual({
            ratings: [2200],
            color: "black",
        });
        expect(store.get(currentMasterOptionsAtom)).toEqual({ since: futureSince });
    });

    it("resets only the active tab player when its database changes", () => {
        const store = createStore();
        initializeTab(store, "tab-a");
        initializeTab(store, "tab-b");

        selectTab(store, "tab-a");
        store.set(setCurrentLocalDatabaseAtom, "/db/a.db3");
        store.set(currentLocalOptionsAtom, (current) => ({ ...current, player: 11 }));

        selectTab(store, "tab-b");
        store.set(setCurrentLocalDatabaseAtom, "/db/b.db3");
        store.set(currentLocalOptionsAtom, (current) => ({ ...current, player: 22 }));

        selectTab(store, "tab-a");
        store.set(setCurrentLocalDatabaseAtom, "/db/a.db3");
        expect(store.get(currentLocalOptionsAtom).player).toBe(11);
        store.set(setCurrentLocalDatabaseAtom, "/db/a-2.db3");
        expect(store.get(currentLocalOptionsAtom).player).toBeNull();

        selectTab(store, "tab-b");
        expect(store.get(currentLocalOptionsAtom)).toMatchObject({
            path: "/db/b.db3",
            player: 22,
        });
    });

    it("syncs board FEN only for exact local queries", () => {
        const store = createStore();
        initializeTab(store, "tab-a");
        selectTab(store, "tab-a");

        store.set(syncCurrentLocalFenAtom, "exact-board-fen");
        expect(store.get(currentLocalOptionsAtom).fen).toBe("exact-board-fen");

        store.set(currentLocalOptionsAtom, (current) => ({
            ...current,
            type: "partial",
            fen: "partial-custom-fen",
        }));
        store.set(syncCurrentLocalFenAtom, "later-board-fen");
        expect(store.get(currentLocalOptionsAtom).fen).toBe("partial-custom-fen");
    });

    it("queries only an initialized, visible, usable explorer", () => {
        expect(
            canQueryDatabaseExplorer({
                initialized: false,
                panel: "stats",
                source: "local",
                localPath: "/db/a.db3",
                missingExplorerToken: false,
            }),
        ).toBe(false);
        expect(
            canQueryDatabaseExplorer({
                initialized: true,
                panel: "options",
                source: "local",
                localPath: "/db/a.db3",
                missingExplorerToken: false,
            }),
        ).toBe(false);
        expect(
            canQueryDatabaseExplorer({
                initialized: true,
                panel: "stats",
                source: "local",
                localPath: null,
                missingExplorerToken: false,
            }),
        ).toBe(false);
        expect(
            canQueryDatabaseExplorer({
                initialized: true,
                panel: "games",
                source: "lch_all",
                localPath: null,
                missingExplorerToken: true,
            }),
        ).toBe(false);
        expect(
            canQueryDatabaseExplorer({
                initialized: true,
                panel: "games",
                source: "lch_master",
                localPath: null,
                missingExplorerToken: false,
            }),
        ).toBe(true);
    });

    it("marks initialization only after every default is copied", () => {
        const store = createStore();
        const since = new Date("2012-01-01T00:00:00.000Z");
        selectTab(store, "tab-a");
        store.set(referenceDbAtom, "/db/default.db3");
        store.set(lichessOptionsDefaultsAtom, { ratings: [1800], color: "black" });
        store.set(masterOptionsDefaultsAtom, { since });

        expect(store.get(currentDatabaseExplorerInitializedAtom)).toBe(false);
        initializeTab(store, "tab-a");

        expect(store.get(currentDatabaseExplorerInitializedAtom)).toBe(true);
        expect(store.get(currentLocalOptionsAtom).path).toBe("/db/default.db3");
        expect(store.get(currentLichessOptionsAtom)).toEqual({
            ratings: [1800],
            color: "black",
        });
        expect(store.get(currentMasterOptionsAtom)).toEqual({ since });
    });

    it("copies an initialized explorer into an independently mutable duplicate", () => {
        const store = createStore();
        const lichessSince = new Date("2010-01-01T00:00:00.000Z");
        const mastersSince = new Date("1990-01-01T00:00:00.000Z");
        initializeTab(store, "source");
        selectTab(store, "source");
        store.set(setCurrentLocalDatabaseAtom, "/db/source.db3");
        store.set(currentLocalOptionsAtom, (current) => ({ ...current, player: 44 }));
        store.set(currentDbTypeAtom, "lch_all");
        store.set(currentDbTabAtom, "games");
        store.set(currentLichessOptionsAtom, {
            ratings: [2000, 2200],
            speeds: ["rapid"],
            color: "black",
            since: lichessSince,
        });
        store.set(currentMasterOptionsAtom, { since: mastersSince });

        const sourceLichess = store.get(currentLichessOptionsAtom);
        const sourceMaster = store.get(currentMasterOptionsAtom);
        store.set(copyDatabaseExplorerStateAtom, {
            sourceTabId: "source",
            targetTabId: "duplicate",
        });

        selectTab(store, "duplicate");
        const duplicateLichess = store.get(currentLichessOptionsAtom);
        const duplicateMaster = store.get(currentMasterOptionsAtom);
        expect(store.get(currentLocalOptionsAtom)).toMatchObject({
            path: "/db/source.db3",
            player: 44,
        });
        expect(store.get(currentDbTypeAtom)).toBe("lch_all");
        expect(store.get(currentDbTabAtom)).toBe("games");
        expect(duplicateLichess).toEqual(sourceLichess);
        expect(duplicateLichess.ratings).not.toBe(sourceLichess.ratings);
        expect(duplicateLichess.since).not.toBe(sourceLichess.since);
        expect(duplicateMaster).toEqual(sourceMaster);
        expect(duplicateMaster.since).not.toBe(sourceMaster.since);

        store.set(setCurrentLocalDatabaseAtom, "/db/duplicate.db3");
        store.set(currentDbTypeAtom, "lch_master");
        store.set(currentDbTabAtom, "options");
        store.set(currentLichessOptionsAtom, {
            ratings: [2500],
            speeds: ["classical"],
            color: "white",
        });
        store.set(currentMasterOptionsAtom, {
            since: new Date("2000-01-01T00:00:00.000Z"),
        });

        selectTab(store, "source");
        expect(store.get(currentLocalOptionsAtom)).toMatchObject({
            path: "/db/source.db3",
            player: 44,
        });
        expect(store.get(currentDbTypeAtom)).toBe("lch_all");
        expect(store.get(currentDbTabAtom)).toBe("games");
        expect(store.get(currentLichessOptionsAtom)).toEqual(sourceLichess);
        expect(store.get(currentMasterOptionsAtom)).toEqual(sourceMaster);
    });

    it("leaves a duplicate uninitialized when the source explorer was never opened", () => {
        const store = createStore();
        store.set(copyDatabaseExplorerStateAtom, {
            sourceTabId: "source",
            targetTabId: "duplicate",
        });
        selectTab(store, "duplicate");
        expect(store.get(currentDatabaseExplorerInitializedAtom)).toBe(false);
    });

    it("removes closed-tab explorer state", () => {
        const store = createStore();
        initializeTab(store, "tab-a");
        selectTab(store, "tab-a");
        store.set(setCurrentLocalDatabaseAtom, "/db/stale.db3");
        store.set(currentDbTypeAtom, "lch_master");
        store.set(currentDbTabAtom, "options");
        store.set(currentLichessOptionsAtom, { ratings: [1000], color: "white" });
        store.set(removeDatabaseExplorerStateAtom, "tab-a");

        store.set(referenceDbAtom, "/db/fresh.db3");
        store.set(lichessOptionsDefaultsAtom, { ratings: [2500], color: "black" });
        store.set(masterOptionsDefaultsAtom, {
            since: new Date("2018-01-01T00:00:00.000Z"),
        });
        initializeTab(store, "tab-a");

        expect(store.get(currentLocalOptionsAtom)).toMatchObject({
            path: "/db/fresh.db3",
            player: null,
            type: "exact",
        });
        expect(store.get(currentDbTypeAtom)).toBe("local");
        expect(store.get(currentDbTabAtom)).toBe("stats");
        expect(store.get(currentLichessOptionsAtom)).toEqual({
            ratings: [2500],
            color: "black",
        });
    });
});
