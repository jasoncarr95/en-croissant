import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";
import {
    activeTabAtom,
    lichessOptionsDefaultsAtom,
    masterOptionsDefaultsAtom,
} from "@/state/atoms";
import {
    adoptReferenceDatabaseAtom,
    canQueryDatabaseExplorer,
    currentDatabaseExplorerInitializedAtom,
    currentDbTabAtom,
    currentDbTypeAtom,
    currentLichessOptionsAtom,
    currentLocalFiltersAtom,
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

// What DatabasePanel does for the active tab once the reference database is known.
const adoptReference = (store: TestStore, tabId: string, referenceDb: string | null) => {
    selectTab(store, tabId);
    store.set(adoptReferenceDatabaseAtom, referenceDb);
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

        store.set(lichessOptionsDefaultsAtom, {
            ratings: [1000],
            speeds: ["blitz"],
            color: "white",
        });
        store.set(masterOptionsDefaultsAtom, { since: mastersSince });
        initializeTab(store, "tab-a");
        initializeTab(store, "tab-b");
        adoptReference(store, "tab-a", "/db/reference.duckdb");
        adoptReference(store, "tab-b", "/db/reference.duckdb");

        selectTab(store, "tab-a");
        store.set(setCurrentLocalDatabaseAtom, "/db/a.duckdb");
        store.set(currentLocalOptionsAtom, (current) => ({
            ...current,
            player1: "Player A",
            outcome: "1-0",
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
        expect(store.get(currentLocalOptionsAtom)).toEqual({ path: "/db/reference.duckdb" });
        expect(store.get(currentDbTypeAtom)).toBe("local");
        expect(store.get(currentDbTabAtom)).toBe("stats");
        expect(store.get(currentLichessOptionsAtom)).toEqual({
            ratings: [1000],
            speeds: ["blitz"],
            color: "white",
        });
        expect(store.get(currentMasterOptionsAtom)).toEqual({ since: mastersSince });
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

        store.set(lichessOptionsDefaultsAtom, { ratings: [1400], color: "white" });
        store.set(masterOptionsDefaultsAtom, { since: originalSince });
        initializeTab(store, "tab-a");
        adoptReference(store, "tab-a", "/db/a.duckdb");

        store.set(lichessOptionsDefaultsAtom, { ratings: [2200], color: "black" });
        store.set(masterOptionsDefaultsAtom, { since: futureSince });
        initializeTab(store, "tab-c");
        adoptReference(store, "tab-c", "/db/b.duckdb");
        adoptReference(store, "tab-a", "/db/b.duckdb");

        selectTab(store, "tab-a");
        expect(store.get(currentLocalOptionsAtom).path).toBe("/db/a.duckdb");
        expect(store.get(currentLichessOptionsAtom)).toEqual({
            ratings: [1400],
            color: "white",
        });
        expect(store.get(currentMasterOptionsAtom)).toEqual({ since: originalSince });

        selectTab(store, "tab-c");
        expect(store.get(currentLocalOptionsAtom).path).toBe("/db/b.duckdb");
        expect(store.get(currentLichessOptionsAtom)).toEqual({
            ratings: [2200],
            color: "black",
        });
        expect(store.get(currentMasterOptionsAtom)).toEqual({ since: futureSince });
    });

    it("takes the reference database only while the tab has none", () => {
        const store = createStore();
        initializeTab(store, "tab-a");
        selectTab(store, "tab-a");
        expect(store.get(currentLocalOptionsAtom).path).toBeNull();

        store.set(adoptReferenceDatabaseAtom, null);
        expect(store.get(currentLocalOptionsAtom).path).toBeNull();

        store.set(adoptReferenceDatabaseAtom, "/db/reference.duckdb");
        expect(store.get(currentLocalOptionsAtom).path).toBe("/db/reference.duckdb");

        store.set(setCurrentLocalDatabaseAtom, "/db/own.duckdb");
        store.set(adoptReferenceDatabaseAtom, "/db/reference.duckdb");
        expect(store.get(currentLocalOptionsAtom).path).toBe("/db/own.duckdb");
    });

    it("keeps a database chosen before the explorer was first opened", () => {
        const store = createStore();
        selectTab(store, "tab-a");
        store.set(currentLocalOptionsAtom, (current) => ({
            ...current,
            path: "/db/player.duckdb",
            player1: "Player A",
        }));

        initializeTab(store, "tab-a");
        store.set(adoptReferenceDatabaseAtom, "/db/reference.duckdb");

        expect(store.get(currentLocalOptionsAtom)).toEqual({
            path: "/db/player.duckdb",
            player1: "Player A",
        });
    });

    it("resets only the active tab's players and tournament when its database changes", () => {
        const store = createStore();
        initializeTab(store, "tab-a");
        initializeTab(store, "tab-b");

        selectTab(store, "tab-a");
        store.set(setCurrentLocalDatabaseAtom, "/db/a.duckdb");
        store.set(currentLocalOptionsAtom, (current) => ({
            ...current,
            player1: "Player A",
            player2: "Opponent A",
            tournament: "Open A",
            outcome: "1-0",
        }));

        selectTab(store, "tab-b");
        store.set(setCurrentLocalDatabaseAtom, "/db/b.duckdb");
        store.set(currentLocalOptionsAtom, (current) => ({ ...current, player1: "Player B" }));

        selectTab(store, "tab-a");
        store.set(setCurrentLocalDatabaseAtom, "/db/a.duckdb");
        expect(store.get(currentLocalOptionsAtom).player1).toBe("Player A");
        store.set(setCurrentLocalDatabaseAtom, "/db/a-2.duckdb");
        expect(store.get(currentLocalOptionsAtom)).toMatchObject({
            path: "/db/a-2.duckdb",
            player1: null,
            player2: null,
            tournament: null,
            outcome: "1-0",
        });

        selectTab(store, "tab-b");
        expect(store.get(currentLocalOptionsAtom)).toMatchObject({
            path: "/db/b.duckdb",
            player1: "Player B",
        });
    });

    it("always searches the exact board position", () => {
        const store = createStore();
        initializeTab(store, "tab-a");
        selectTab(store, "tab-a");

        store.set(syncCurrentLocalFenAtom, "board-fen");
        expect(store.get(currentLocalOptionsAtom).position).toEqual({
            fen: "board-fen",
            type_: "exact",
        });

        const synced = store.get(currentLocalOptionsAtom);
        store.set(syncCurrentLocalFenAtom, "board-fen");
        expect(store.get(currentLocalOptionsAtom)).toBe(synced);

        store.set(currentLocalOptionsAtom, (current) => ({
            ...current,
            position: { fen: "custom-query", type_: "scoutfish" },
        }));
        store.set(syncCurrentLocalFenAtom, "board-after-e4");
        expect(store.get(currentLocalOptionsAtom).position).toEqual({
            fen: "board-after-e4",
            type_: "exact",
        });
    });

    it("edits filters without touching the tab's database", () => {
        const store = createStore();
        initializeTab(store, "tab-a");
        adoptReference(store, "tab-a", "/db/a.duckdb");
        store.set(syncCurrentLocalFenAtom, "board-fen");

        expect(store.get(currentLocalFiltersAtom)).toEqual({
            position: { fen: "board-fen", type_: "exact" },
        });

        store.set(currentLocalFiltersAtom, { player1: "Player A", outcome: "1-0" });
        expect(store.get(currentLocalOptionsAtom)).toEqual({
            path: "/db/a.duckdb",
            player1: "Player A",
            outcome: "1-0",
        });

        store.set(currentLocalFiltersAtom, (current) => ({ ...current, outcome: "0-1" }));
        expect(store.get(currentLocalOptionsAtom)).toEqual({
            path: "/db/a.duckdb",
            player1: "Player A",
            outcome: "0-1",
        });
    });

    it("queries only an initialized, visible, usable explorer", () => {
        expect(
            canQueryDatabaseExplorer({
                initialized: false,
                panel: "stats",
                source: "local",
                localPath: "/db/a.duckdb",
                missingExplorerToken: false,
            }),
        ).toBe(false);
        expect(
            canQueryDatabaseExplorer({
                initialized: true,
                panel: "options",
                source: "local",
                localPath: "/db/a.duckdb",
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
        store.set(lichessOptionsDefaultsAtom, { ratings: [1800], color: "black" });
        store.set(masterOptionsDefaultsAtom, { since });

        expect(store.get(currentDatabaseExplorerInitializedAtom)).toBe(false);
        initializeTab(store, "tab-a");

        expect(store.get(currentDatabaseExplorerInitializedAtom)).toBe(true);
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
        store.set(setCurrentLocalDatabaseAtom, "/db/source.duckdb");
        store.set(currentLocalOptionsAtom, (current) => ({ ...current, player1: "Source Player" }));
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
            path: "/db/source.duckdb",
            player1: "Source Player",
        });
        expect(store.get(currentDbTypeAtom)).toBe("lch_all");
        expect(store.get(currentDbTabAtom)).toBe("games");
        expect(duplicateLichess).toEqual(sourceLichess);
        expect(duplicateLichess.ratings).not.toBe(sourceLichess.ratings);
        expect(duplicateLichess.since).not.toBe(sourceLichess.since);
        expect(duplicateMaster).toEqual(sourceMaster);
        expect(duplicateMaster.since).not.toBe(sourceMaster.since);

        store.set(setCurrentLocalDatabaseAtom, "/db/duplicate.duckdb");
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
            path: "/db/source.duckdb",
            player1: "Source Player",
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
        store.set(setCurrentLocalDatabaseAtom, "/db/stale.duckdb");
        store.set(currentLocalOptionsAtom, (current) => ({ ...current, player1: "Stale Player" }));
        store.set(currentDbTypeAtom, "lch_master");
        store.set(currentDbTabAtom, "options");
        store.set(currentLichessOptionsAtom, { ratings: [1000], color: "white" });
        store.set(removeDatabaseExplorerStateAtom, "tab-a");

        store.set(lichessOptionsDefaultsAtom, { ratings: [2500], color: "black" });
        store.set(masterOptionsDefaultsAtom, {
            since: new Date("2018-01-01T00:00:00.000Z"),
        });
        initializeTab(store, "tab-a");
        adoptReference(store, "tab-a", "/db/fresh.duckdb");

        expect(store.get(currentLocalOptionsAtom)).toEqual({ path: "/db/fresh.duckdb" });
        expect(store.get(currentDbTypeAtom)).toBe("local");
        expect(store.get(currentDbTabAtom)).toBe("stats");
        expect(store.get(currentLichessOptionsAtom)).toEqual({
            ratings: [2500],
            color: "black",
        });
    });
});
