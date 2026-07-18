import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";
import {
    activeTabAtom,
    lichessOptionsDefaultsAtom,
    masterOptionsDefaultsAtom,
    referenceDbAtom,
} from "@/state/atoms";
import {
    currentDbTabAtom,
    currentDbTypeAtom,
    currentLichessOptionsAtom,
    currentLocalOptionsAtom,
    currentMasterOptionsAtom,
    initializeDatabaseExplorerStateAtom,
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
});
